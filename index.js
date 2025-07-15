const puppeteer = require('puppeteer');
const { google } = require('googleapis');

// 🔄 Version 4 - Includes image URL scraping for Column AC

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

  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:A`,
  });
  const rowCount = (rowRes.data.values || []).length;
  console.log(`📄 Found ${rowCount} rows`);

  const [urlRes, timeRes, alertRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!P2:P${rowCount + 1}` }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!Q2:Q${rowCount + 1}` }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!S2:S${rowCount + 1}` }),
  ]);

  const urls = urlRes.data.values || [];
  const timestamps = timeRes.data.values || [];
  const alerts = alertRes.data.values || [];

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const updates = [];

  for (let i = 0; i < urls.length; i++) {
    const rowIndex = i + 2;
    const url = urls[i]?.[0]?.trim();
    const timestampStr = timestamps[i]?.[0];
    const alertFlag = alerts[i]?.[0]?.trim();

    if (!url) {
      console.log(`⏭️ Row ${rowIndex}: Empty URL`);
      continue;
    }

    const date = new Date(timestampStr);
    if (!isNaN(date) && date < new Date()) {
      console.log(`⏭️ Row ${rowIndex}: Timestamp passed`);
      continue;
    }

    if (alertFlag) {
      console.log(`⏭️ Row ${rowIndex}: Already alerted`);
      continue;
    }

    const page = await browser.newPage();

    try {
      console.log(`🔍 Visiting row ${rowIndex}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      const spans = await page.$$eval('.h1.font-weight-normal.text-accent.mb-0 span', els =>
        els.map(el => el.textContent.trim())
      );
      const price = spans[1] || 'Unavailable';

      const imageUrl = await page.$eval(
        'img[src^="https://m.media-amazon.com/images/"]',
        el => el.src
      ).catch(() => '');

      console.log(`💰 Price: ${price}`);
      console.log(`🖼 Image: ${imageUrl}`);

      updates.push({ range: `${sheetName}!R${rowIndex}`, values: [[price]] });
      updates.push({ range: `${sheetName}!AC${rowIndex}`, values: [[imageUrl]] });

    } catch (err) {
      console.warn(`⚠️ Row ${rowIndex}: Scrape failed — ${err.message}`);
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
    console.log(`✅ Updates written: ${updates.length} entries`);
  } else {
    console.log('ℹ️ No new updates to apply');
  }
})();
