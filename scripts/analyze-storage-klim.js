const fs = require('fs');
const path = require('path');
const https = require('https');
const XLSX = require('xlsx');

const ROOT_DIR = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT_DIR, 'public', 'index.html');
const OUTPUT_DIR = path.join(ROOT_DIR, 'exports');
const TIMEZONE = 'America/Bogota';
const BUCKET_PREFIX = 'Klim/';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readFirebaseConfig() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const apiKey = html.match(/apiKey:\s*"([^"]+)"/)?.[1];
  const projectId = html.match(/projectId:\s*"([^"]+)"/)?.[1];
  const storageBucket = html.match(/storageBucket:\s*"([^"]+)"/)?.[1];

  if (!apiKey || !projectId || !storageBucket) {
    throw new Error('No pude leer apiKey/projectId/storageBucket desde public/index.html');
  }

  return { apiKey, projectId, storageBucket };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              return reject(
                new Error(
                  `La API devolvio ${res.statusCode}: ${parsed.error?.message || data}`
                )
              );
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

function decodeFirestoreValue(value) {
  if (value === null || value === undefined) return '';
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.booleanValue !== undefined) return Boolean(value.booleanValue);
  if (value.nullValue !== undefined) return null;
  if (value.mapValue?.fields) return decodeFirestoreFields(value.mapValue.fields);
  if (value.arrayValue?.values) return value.arrayValue.values.map(decodeFirestoreValue);
  return '';
}

function decodeFirestoreFields(fields = {}) {
  const row = {};
  for (const [key, value] of Object.entries(fields)) {
    row[key] = decodeFirestoreValue(value);
  }
  return row;
}

async function fetchFirestoreCollection(projectId, apiKey, collectionName) {
  const docs = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`
    );
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await getJson(url.toString());
    for (const doc of response.documents || []) {
      docs.push({
        id: doc.name.split('/').pop(),
        createTime: doc.createTime,
        updateTime: doc.updateTime,
        ...decodeFirestoreFields(doc.fields),
      });
    }
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return docs;
}

async function fetchStorageObjects(storageBucket) {
  const items = [];
  let pageToken = '';

  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${storageBucket}/o`);
    url.searchParams.set('prefix', BUCKET_PREFIX);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await getJson(url.toString());
    for (const item of response.items || []) {
      if (item.name === BUCKET_PREFIX) continue;
      items.push(item);
    }
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return items;
}

function toBogotaDate(isoString) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(isoString));
}

function pct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function buildPublicDownloadUrl(storageBucket, objectName, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(
    objectName
  )}?alt=media&token=${token}`;
}

function analyze(storageObjects, dailyStats, storageBucket) {
  const storageRows = storageObjects.map((item) => {
    const localDate = toBogotaDate(item.timeCreated);
    const token = item.metadata?.firebaseStorageDownloadTokens || '';
    return {
      name: item.name,
      filename: item.name.split('/').pop(),
      size_bytes: Number(item.size || 0),
      size_kb: Number((Number(item.size || 0) / 1024).toFixed(2)),
      content_type: item.contentType || '',
      created_utc: item.timeCreated,
      created_local_date: localDate,
      updated_utc: item.updated,
      generation: item.generation,
      download_token: token,
      download_url: token ? buildPublicDownloadUrl(storageBucket, item.name, token) : '',
    };
  });

  const byDay = new Map();
  for (const row of storageRows) {
    const current = byDay.get(row.created_local_date) || {
      date: row.created_local_date,
      image_count: 0,
      total_size_kb: 0,
    };
    current.image_count += 1;
    current.total_size_kb += row.size_kb;
    byDay.set(row.created_local_date, current);
  }

  const firestoreByDay = new Map(
    dailyStats.map((row) => [
      row.date,
      {
        total: Number(row.total || 0),
        happy: Number(row.happy || 0),
        surprise: Number(row.surprise || 0),
        serious: Number(row.serious || 0),
        disgust: Number(row.disgust || 0),
      },
    ])
  );

  const allDates = Array.from(
    new Set([...byDay.keys(), ...firestoreByDay.keys()])
  ).sort((a, b) => a.localeCompare(b));

  const crossRows = allDates.map((date) => {
    const storage = byDay.get(date) || { image_count: 0, total_size_kb: 0 };
    const stats = firestoreByDay.get(date) || {
      total: 0,
      happy: 0,
      surprise: 0,
      serious: 0,
      disgust: 0,
    };
    const delta = storage.image_count - stats.total;
    return {
      date,
      image_count: storage.image_count,
      stats_total: stats.total,
      delta_images_minus_stats: delta,
      matched_pct: stats.total ? pct(Math.min(storage.image_count, stats.total), stats.total) : 0,
      happy: stats.happy,
      surprise: stats.surprise,
      serious: stats.serious,
      disgust: stats.disgust,
      positive_pct: pct(stats.happy + stats.surprise, stats.total),
      negative_pct: pct(stats.serious + stats.disgust, stats.total),
      total_size_kb: Number(storage.total_size_kb.toFixed(2)),
    };
  });

  const totalImages = storageRows.length;
  const totalSizeKb = storageRows.reduce((sum, row) => sum + row.size_kb, 0);
  const topDay = [...crossRows].sort((a, b) => b.image_count - a.image_count)[0] || null;
  const topStatsDay = [...crossRows].sort((a, b) => b.stats_total - a.stats_total)[0] || null;
  const worstMismatch = [...crossRows]
    .sort((a, b) => Math.abs(b.delta_images_minus_stats) - Math.abs(a.delta_images_minus_stats))[0] || null;

  const summaryRows = [
    { metric: 'storage_bucket', value: storageBucket },
    { metric: 'timezone_used_for_day_grouping', value: TIMEZONE },
    { metric: 'total_images_in_bucket_folder', value: totalImages },
    { metric: 'total_days_with_images', value: byDay.size },
    { metric: 'first_image_day', value: crossRows[0]?.date || '' },
    { metric: 'last_image_day', value: crossRows[crossRows.length - 1]?.date || '' },
    { metric: 'total_storage_size_kb', value: Number(totalSizeKb.toFixed(2)) },
    {
      metric: 'avg_images_per_active_day',
      value: byDay.size ? Number((totalImages / byDay.size).toFixed(2)) : 0,
    },
    { metric: 'day_with_most_images', value: topDay?.date || '' },
    { metric: 'day_with_most_images_count', value: topDay?.image_count || 0 },
    { metric: 'day_with_most_stats_total', value: topStatsDay?.date || '' },
    { metric: 'day_with_most_stats_total_count', value: topStatsDay?.stats_total || 0 },
    { metric: 'largest_images_vs_stats_delta_day', value: worstMismatch?.date || '' },
    {
      metric: 'largest_images_vs_stats_delta_value',
      value: worstMismatch?.delta_images_minus_stats || 0,
    },
  ];

  return { storageRows, crossRows, summaryRows };
}

function saveWorkbook(analysis) {
  ensureDir(OUTPUT_DIR);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.summaryRows),
    'summary'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.crossRows),
    'daily_crosscheck'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.storageRows),
    'storage_objects'
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const xlsxPath = path.join(OUTPUT_DIR, `klim_storage_analysis_${stamp}.xlsx`);
  const jsonPath = path.join(OUTPUT_DIR, `klim_storage_analysis_${stamp}.json`);
  XLSX.writeFile(workbook, xlsxPath);
  fs.writeFileSync(jsonPath, JSON.stringify(analysis, null, 2), 'utf8');

  return { xlsxPath, jsonPath };
}

async function main() {
  const { apiKey, projectId, storageBucket } = readFirebaseConfig();
  const [dailyStats, storageObjects] = await Promise.all([
    fetchFirestoreCollection(projectId, apiKey, 'KLIM_STATS_DAILY'),
    fetchStorageObjects(storageBucket),
  ]);

  const normalizedDaily = dailyStats
    .map((row) => ({
      date: row.date,
      total: Number(row.total || 0),
      happy: Number(row.happy || 0),
      surprise: Number(row.surprise || 0),
      serious: Number(row.serious || 0),
      disgust: Number(row.disgust || 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const analysis = analyze(storageObjects, normalizedDaily, storageBucket);
  const files = saveWorkbook(analysis);

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        storageBucket,
        totalStorageObjects: analysis.storageRows.length,
        totalDailyRows: analysis.crossRows.length,
        files,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
