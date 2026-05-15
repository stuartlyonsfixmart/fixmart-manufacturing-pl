'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { BigQuery } = require('@google-cloud/bigquery');
const NodeCache = require('node-cache');

const app = express();
const PROJECT_ID = process.env.BQ_PROJECT_ID || 'project-aa7ee149-5e29-4eb4-8bc';
const bq = new BigQuery({ projectId: PROJECT_ID });
const cache = new NodeCache({ stdTTL: 600 });

const PORT = process.env.PORT || 8080;
const USERS = { pete: 'pete' };

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fixmart-mfg-pl-2026',
  resave: true,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, secure: false, sameSite: 'lax' }
}));

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/logo.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logo.js'));
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // API routes get JSON 401; page routes get redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'session_expired' });
  }
  res.redirect('/login.html');
}

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    req.session.save(err => { if (err) console.error(err); res.redirect('/'); });
  } else {
    res.redirect('/login.html?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

const DS = `\`${PROJECT_ID}.fixmart_bi.vw_manufacturing_pl\``;

app.get('/api/summary', requireAuth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'missing dates' });
  const cacheKey = `s_${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached, fromCache: true });
  try {
    const [rows] = await bq.query({
      query: `SELECT period_date, ROUND(SUM(CASE WHEN section='Revenue' THEN net_amount ELSE 0 END),2) AS revenue, ROUND(SUM(CASE WHEN section='Cost' THEN net_amount ELSE 0 END),2) AS costs, ROUND(SUM(net_amount),2) AS net_result FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate GROUP BY 1 ORDER BY 1`,
      params: { startDate, endDate }, location: 'europe-west2'
    });
    const data = rows.map(r => ({
      period_date: r.period_date ? r.period_date.value || String(r.period_date) : '',
      revenue: r.revenue, costs: r.costs, net_result: r.net_result
    }));
    cache.set(cacheKey, data);
    res.json({ success: true, data, fromCache: false });
  } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/lines', requireAuth, async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'missing dates' });
  const cacheKey = `l_${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached, fromCache: true });
  try {
    const [rows] = await bq.query({
      query: `SELECT period_date, section, line_label, ROUND(SUM(net_amount),2) AS total FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate GROUP BY 1,2,3 ORDER BY 1,2,3`,
      params: { startDate, endDate }, location: 'europe-west2'
    });
    const data = rows.map(r => ({
      period_date: r.period_date ? r.period_date.value || String(r.period_date) : '',
      section: r.section, line_label: r.line_label, total: r.total
    }));
    cache.set(cacheKey, data);
    res.json({ success: true, data, fromCache: false });
  } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/detail', requireAuth, async (req, res) => {
  const { startDate, endDate, lineLabel } = req.query;
  if (!startDate || !endDate || !lineLabel) return res.status(400).json({ success: false, error: 'missing params' });
  const cacheKey = `d_${startDate}_${endDate}_${lineLabel}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached, fromCache: true });
  try {
    const [rows] = await bq.query({
      query: `SELECT DISTINCT transaction_date, reference, description, nominal, source, ROUND(net_amount,2) AS net_amount FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate AND line_label=@lineLabel ORDER BY transaction_date, net_amount`,
      params: { startDate, endDate, lineLabel }, location: 'europe-west2'
    });
    const data = rows.map(r => ({
      transaction_date: r.transaction_date ? r.transaction_date.value || String(r.transaction_date) : '',
      reference: r.reference || '', description: r.description || '',
      nominal: r.nominal, source: r.source, net_amount: r.net_amount
    }));
    cache.set(cacheKey, data);
    res.json({ success: true, data, fromCache: false });
  } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.redirect('/login.html');
});

app.listen(PORT, () => console.log(`Manufacturing P&L running on port ${PORT}`));
