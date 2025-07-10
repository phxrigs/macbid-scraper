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
  const idRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: idRange,
  });
  const rowCount = (idRes.data.values || []).length;
  console.log(`📄 Found ${rowCount} rows in column A`);

  const urlRange = `${sheetName}!N2:N${rowCount + 1}`;
  const timestampRange = `${sheetName}!V2:V${rowCount + 1}`;

  const [urlRes, timeRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: urlRange }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: timestampRange })
  ]);

  const urls = urlRes.data.values || [];
  const timestamps = timeRes.data.values || [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const updates = [];

  for (let i = 0; i < urls.length; i++) {
    const rowIndex = i + 2;
    const url = urls[i]?.[0] || '';
    const timestampStr = timestamps[i]?.[0] || '';

    if (!url.trim()) {
      console.log(`⏭️ Skipping row ${rowIndex}: empty URL`);
      continue;
    }

    const date = new Date(timestampStr);
    if (!isNaN(date) && date < new Date()) {
      console.log(`⏭️ Skipping row ${rowIndex}: timestamp has passed`);
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
      console.log(`💰 Row ${rowIndex}: ${price} (${Date.now() - start}ms)`);

      updates.push({
        range: `${sheetName}!R${rowIndex}`,
        values: [[price]],
      });
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
    console.log('✅ All prices written to column R.');
  } else {
    console.log('ℹ️ No updates applied.');
  }
})();