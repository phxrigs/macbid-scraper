const puppeteer = require('puppeteer');
const { google } = require('googleapis');

// 🔄 Version 4.9 — Diagnostic logging to expose image/price loading issues

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
  headless: 'new', // or true for compatibility
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
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

      if (url.includes('/search?')) {
        const productLinks = await page.$$eval('a[href]', els =>
          els.map(el => el.href)
        );
        console.log(`🔗 Row ${rowIndex}: Found ${productLinks.length} anchor links`);
        productLinks.forEach((link, i) => {
          if (link.includes('/lot/')) {
            console.log(`🧭 Link [${i}] matches /lot/: ${link}`);
          }
        });

        const productUrl = await page.$eval('a[href*="/lot/"]', el => el.href).catch(() => '');
        if (!productUrl) {
          console.warn(`🚫 Row ${rowIndex}: No product link found on search page`);
          continue;
        }

        console.log(`↪️ Row ${rowIndex}: Redirecting to product page — ${productUrl}`);
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      }

      console.log(`📍 Row ${rowIndex}: Current page URL is ${page.url()}`);

      await page.waitForSelector('div.cz-preview-item.active img, div.swiper-slide img', { timeout: 5000 }).catch(() =>
        console.warn(`⏳ Row ${rowIndex}: No image container appeared`)
      );

      const html = await page.content();
      console.log(`🔬 Row ${rowIndex}: HTML length = ${html.length}`);
      console.log(`📄 Row ${rowIndex}: HTML preview:\n${html.slice(0, 500)}`);

      const rawSpans = await page.$$eval('.h1.font-weight-normal.text-accent.mb-0 span', els =>
        els.map(el => el.textContent.trim())
      );
      console.log(`🏷️ Row ${rowIndex}: Raw price spans —`, rawSpans);

      const price = rawSpans[1] || 'Unavailable';

      const imageUrl = await page.$$eval(
        'div.cz-preview-item.active img, div.swiper-slide img',
        imgs => imgs.map(img => img.src).find(src =>
          src && /\.(jpg|jpeg|png|webp|gif)$/i.test(src)
        )
      ).catch(() => '');

      if (imageUrl) {
        console.log(`✅ Row ${rowIndex}: Image URL resolved — ${imageUrl}`);
      } else {
        console.warn(`🚫 Row ${rowIndex}: No valid image URL found`);
      }

      const imageFormula = imageUrl
        ? `=IMAGE("${imageUrl}", 4, 60, 60)`
        : '';

      console.log(`💰 Row ${rowIndex}: ${price}`);
      console.log(`🖼 Formula: ${imageFormula || '[empty]'}`);

      // Optional visual debug — screenshot
      // await page.screenshot({ path: `row-${rowIndex}.png`, fullPage: true });

      updates.push({ range: `${sheetName}!R${rowIndex}`, values: [[price]] });
      updates.push({ range: `${sheetName}!AC${rowIndex}`, values: [[imageFormula]] });

    } catch (err) {
      console.warn(`⚠️ Row ${rowIndex}: Scrape failed — ${err.message}`);
    } finally {
      try {
        if (!page.isClosed()) await page.close();
      } catch (closeErr) {
        console.warn(`⚠️ Row ${rowIndex}: Page close error — ${closeErr.message}`);
      }
    }
  }

  await browser.close();

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
    console.log(`✅ Updates written: ${updates.length} entries`);
  } else {
    console.log('ℹ️ No new updates to apply');
  }
})();