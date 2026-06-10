const fs = require('fs');
const path = require('path');
const https = require('https');
const XLSX = require('xlsx');

const ROOT_DIR = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT_DIR, 'public', 'index.html');
const OUTPUT_DIR = path.join(ROOT_DIR, 'exports');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readFirebaseWebConfig() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const apiKey = html.match(/apiKey:\s*"([^"]+)"/)?.[1];
  const projectId = html.match(/projectId:\s*"([^"]+)"/)?.[1];

  if (!apiKey || !projectId) {
    throw new Error('No pude leer apiKey/projectId desde public/index.html');
  }

  return { apiKey, projectId };
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return '';
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.booleanValue !== undefined) return Boolean(value.booleanValue);
  if (value.nullValue !== undefined) return null;
  if (value.mapValue?.fields) return decodeFields(value.mapValue.fields);
  if (value.arrayValue?.values) return value.arrayValue.values.map(toFirestoreValue);
  return '';
}

function decodeFields(fields = {}) {
  const row = {};
  for (const [key, value] of Object.entries(fields)) {
    row[key] = toFirestoreValue(value);
  }
  return row;
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
                  `Firestore devolvio ${res.statusCode}: ${parsed.error?.message || data}`
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

async function fetchCollection(projectId, apiKey, collectionName) {
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
        ...decodeFields(doc.fields),
      });
    }
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return docs;
}

function pct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function buildAnalysis(globalStats, dailyStats) {
  const sortedDaily = [...dailyStats].sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = sortedDaily.filter((row) => Number(row.total || 0) > 0);
  const totalDaily = activeDays.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const monthlyMap = new Map();

  for (const row of activeDays) {
    const month = row.date.slice(0, 7);
    const current = monthlyMap.get(month) || {
      month,
      total: 0,
      happy: 0,
      surprise: 0,
      serious: 0,
      disgust: 0,
    };

    current.total += Number(row.total || 0);
    current.happy += Number(row.happy || 0);
    current.surprise += Number(row.surprise || 0);
    current.serious += Number(row.serious || 0);
    current.disgust += Number(row.disgust || 0);
    monthlyMap.set(month, current);
  }

  const topDay = [...activeDays].sort((a, b) => b.total - a.total)[0] || null;
  const lowestDay = [...activeDays].sort((a, b) => a.total - b.total)[0] || null;
  const happiestDay =
    [...activeDays]
      .map((row) => ({ ...row, happyPct: pct(row.happy || 0, row.total || 0) }))
      .sort((a, b) => b.happyPct - a.happyPct || b.total - a.total)[0] || null;
  const negativeDay =
    [...activeDays]
      .map((row) => ({
        ...row,
        negative: Number(row.serious || 0) + Number(row.disgust || 0),
        negativePct: pct(Number(row.serious || 0) + Number(row.disgust || 0), row.total || 0),
      }))
      .sort((a, b) => b.negativePct - a.negativePct || b.total - a.total)[0] || null;

  const globalTotal = Number(globalStats.total || 0);
  const summaryRows = [
    { metric: 'project_id', value: globalStats.projectId || '' },
    { metric: 'global_total', value: globalTotal },
    { metric: 'global_happy', value: Number(globalStats.happy || 0) },
    { metric: 'global_surprise', value: Number(globalStats.surprise || 0) },
    { metric: 'global_serious', value: Number(globalStats.serious || 0) },
    { metric: 'global_disgust', value: Number(globalStats.disgust || 0) },
    { metric: 'happy_pct', value: pct(globalStats.happy || 0, globalTotal) },
    { metric: 'surprise_pct', value: pct(globalStats.surprise || 0, globalTotal) },
    { metric: 'serious_pct', value: pct(globalStats.serious || 0, globalTotal) },
    { metric: 'disgust_pct', value: pct(globalStats.disgust || 0, globalTotal) },
    {
      metric: 'positive_pct',
      value: pct(Number(globalStats.happy || 0) + Number(globalStats.surprise || 0), globalTotal),
    },
    {
      metric: 'negative_pct',
      value: pct(Number(globalStats.serious || 0) + Number(globalStats.disgust || 0), globalTotal),
    },
    { metric: 'daily_records', value: sortedDaily.length },
    { metric: 'active_days', value: activeDays.length },
    { metric: 'first_day', value: sortedDaily[0]?.date || '' },
    { metric: 'last_day', value: sortedDaily[sortedDaily.length - 1]?.date || '' },
    { metric: 'sum_daily_total', value: totalDaily },
    { metric: 'global_minus_daily', value: globalTotal - totalDaily },
    {
      metric: 'avg_people_per_active_day',
      value: activeDays.length ? Number((totalDaily / activeDays.length).toFixed(2)) : 0,
    },
    { metric: 'top_volume_day', value: topDay?.date || '' },
    { metric: 'top_volume_total', value: topDay?.total || 0 },
    { metric: 'lowest_volume_day', value: lowestDay?.date || '' },
    { metric: 'lowest_volume_total', value: lowestDay?.total || 0 },
    { metric: 'happiest_day', value: happiestDay?.date || '' },
    { metric: 'happiest_day_happy_pct', value: happiestDay?.happyPct || 0 },
    { metric: 'highest_negative_day', value: negativeDay?.date || '' },
    { metric: 'highest_negative_pct', value: negativeDay?.negativePct || 0 },
  ];

  const monthlyRows = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      ...row,
      happy_pct: pct(row.happy, row.total),
      surprise_pct: pct(row.surprise, row.total),
      serious_pct: pct(row.serious, row.total),
      disgust_pct: pct(row.disgust, row.total),
      positive_pct: pct(row.happy + row.surprise, row.total),
      negative_pct: pct(row.serious + row.disgust, row.total),
    }));

  const dailyAnalysisRows = sortedDaily.map((row) => {
    const total = Number(row.total || 0);
    const happy = Number(row.happy || 0);
    const surprise = Number(row.surprise || 0);
    const serious = Number(row.serious || 0);
    const disgust = Number(row.disgust || 0);
    const positive = happy + surprise;
    const negative = serious + disgust;

    return {
      ...row,
      positive,
      negative,
      happy_pct: pct(happy, total),
      surprise_pct: pct(surprise, total),
      serious_pct: pct(serious, total),
      disgust_pct: pct(disgust, total),
      positive_pct: pct(positive, total),
      negative_pct: pct(negative, total),
    };
  });

  return { summaryRows, monthlyRows, dailyAnalysisRows };
}

function saveWorkbook(globalRows, dailyRows, analysis) {
  ensureDir(OUTPUT_DIR);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(globalRows), 'global');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dailyRows), 'daily');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.summaryRows),
    'summary'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.monthlyRows),
    'monthly'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(analysis.dailyAnalysisRows),
    'daily_analysis'
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const xlsxPath = path.join(OUTPUT_DIR, `klim_stats_export_${stamp}.xlsx`);
  const jsonPath = path.join(OUTPUT_DIR, `klim_stats_export_${stamp}.json`);
  XLSX.writeFile(workbook, xlsxPath);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        global: globalRows,
        daily: dailyRows,
        summary: analysis.summaryRows,
        monthly: analysis.monthlyRows,
      },
      null,
      2
    ),
    'utf8'
  );

  return { xlsxPath, jsonPath };
}

async function main() {
  const { apiKey, projectId } = readFirebaseWebConfig();
  const [globalDocs, dailyDocs] = await Promise.all([
    fetchCollection(projectId, apiKey, 'KLIM_STATS'),
    fetchCollection(projectId, apiKey, 'KLIM_STATS_DAILY'),
  ]);

  if (!globalDocs.length) {
    throw new Error('La coleccion KLIM_STATS no devolvio documentos');
  }

  const globalRows = globalDocs.map((row) => ({
    ...row,
    projectId,
    happy_pct: pct(row.happy || 0, row.total || 0),
    surprise_pct: pct(row.surprise || 0, row.total || 0),
    serious_pct: pct(row.serious || 0, row.total || 0),
    disgust_pct: pct(row.disgust || 0, row.total || 0),
    positive_pct: pct(Number(row.happy || 0) + Number(row.surprise || 0), row.total || 0),
    negative_pct: pct(Number(row.serious || 0) + Number(row.disgust || 0), row.total || 0),
  }));

  const dailyRows = dailyDocs
    .map((row) => ({
      ...row,
      total: Number(row.total || 0),
      happy: Number(row.happy || 0),
      surprise: Number(row.surprise || 0),
      serious: Number(row.serious || 0),
      disgust: Number(row.disgust || 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const analysis = buildAnalysis({ ...globalRows[0], projectId }, dailyRows);
  const output = saveWorkbook(globalRows, dailyRows, analysis);

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        globalDocs: globalRows.length,
        dailyDocs: dailyRows.length,
        files: output,
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
