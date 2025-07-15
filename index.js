const puppeteer = require('puppeteer');
const fs = require('fs');
const { google } = require('googleapis');

const keys = JSON.parse(process.env.GOOGLE_CREDENTIALS);
keys.private_key = keys.private_key.replace(/\\n/g, '\n');

(async () => {
  const auth = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheetId = '1CypDOy2PseT9FPz9cyz1JdFhsUmyfnrMGKSmJ2V0fe0';
  const sheetName = 'InHunt';

  const idRange = `${sheetName}!A2:A`;
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: idRange,
  });
  const rowCount = (rowRes.data.values || []).length;
  console.log(`📄 Found ${rowCount} rows in column A`);

  const urlRange = `${sheetName}!P2:P${rowCount + 1}`;
  const timestampRange = `${sheetName}!Q2:Q${rowCount + 1}`;
  const alertRange = `${sheetName}!S2:S${rowCount + 1}`;

  const [urlRes, timeRes, alertRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: urlRange }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: timestampRange }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: alertRange }),
  ]);

  const urls = urlRes.data.values || [];
  const timestamps = timeRes.data.values || [];
  const alerts = alertRes.data.values || [];

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const updates = [];

  for (let i = 0; i < urls.length; i++) {
    const rowIndex = i + 2;
    const url = urls[i]?.[0] || '';
    const timestampStr = timestamps[i]?.[0] || '';
    const alertFlag = alerts[i]?.[0] || '';

    if (!url.trim()) {
      console.log(`⏭️ Skipping row ${rowIndex}: empty URL`);
      continue;
    }

    const date = new Date(timestampStr);
    if (!isNaN(date) && date < new Date()) {
      console.log(`⏭️ Skipping row ${rowIndex}: timestamp has passed`);
      continue;
    }

    if (alertFlag.trim()) {
      console.log(`⏭️ Skipping row ${rowIndex}: already alerted`);
      continue;
    }

    const page = await browser.newPage();
    const start = Date.now();

    try {
      console.log(`🔍 Visiting row ${rowIndex}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      const spans = await page.$$eval('.h1.font-weight-normal.text-accent.mb-0 span', els =>
        els.map(el => el.textContent.trim())
      );
      const price = spans[1] || 'Unavailable';

      const imageUrl = await page.$eval('img[src^="https://m.media-amazon.com/images/"]', el => el.src)
        .catch(() => '');

      console.log(`💰 Row ${rowIndex}: ${price}`);
      console.log(`🖼 Row ${rowIndex}: ${imageUrl}`);

      updates.push({ range: `${sheetName}!R${rowIndex}`, values: [[price]] });
      updates.push({ range: `${sheetName}!AC${rowIndex}`, values: [[imageUrl]] });
    } catch (err) {
      console.warn(`⚠️ Row ${rowIndex}: Failed to scrape ${url} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
    console.log('✅ All updates written to Columns R and AC.');
  } else {
    console.log('ℹ️ No updates applied.');
  }
})();
