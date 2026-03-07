const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const SECRET_KEY = process.env.SECRET_KEY || '';

// ── middleware تحقق من السيكريت ──────────────────────────────
function checkSecret(req, res, next) {
  if (!SECRET_KEY) return next(); // إذا ما في secret محدد، اسمح للكل
  const provided = req.headers['x-secret'] || '';
  if (provided !== SECRET_KEY) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── إرسال DM ──────────────────────────────────────────────
app.post('/discord-dm', checkSecret, async (req, res) => {
  try {
    const { userId, payload } = req.body;
    if (!userId || !payload) return res.status(400).json({ error: 'userId and payload required' });
    if (!BOT_TOKEN) return res.status(500).json({ error: 'BOT_TOKEN not set' });

    // فتح DM channel
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!dmRes.ok) return res.status(dmRes.status).json({ error: await dmRes.text() });
    const dmCh = await dmRes.json();

    // إرسال الرسالة
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmCh.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
      body: JSON.stringify(payload)
    });
    if (!msgRes.ok) return res.status(msgRes.status).json({ error: await msgRes.text() });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── رسالة ترحيب عند لوغين ─────────────────────────────────
app.post('/discord-unlock-dm', async (req, res) => {
  try {
    const { oauthToken } = req.body;
    if (!oauthToken) return res.status(400).json({ error: 'oauthToken required' });
    if (!BOT_TOKEN) return res.status(500).json({ error: 'BOT_TOKEN not set' });

    // نجيب ID البوت
    const botRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    if (!botRes.ok) return res.status(500).json({ error: 'Failed to get bot info' });
    const bot = await botRes.json();

    // المستخدم يفتح DM مع البوت
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oauthToken}` },
      body: JSON.stringify({ recipient_id: bot.id })
    });
    if (!dmRes.ok) return res.status(dmRes.status).json({ error: 'Failed to open DM' });
    const dmCh = await dmRes.json();

    // البوت يرسل رسالة ترحيب
    await fetch(`https://discord.com/api/v10/channels/${dmCh.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
      body: JSON.stringify({
        embeds: [{
          title: '👋 مرحباً في TSRP!',
          description: 'تم ربط حسابك بالموقع بنجاح.\nسيتم إرسال إشعارات التوظيف والتحديثات هنا مباشرة.',
          color: 0x107fe1,
          footer: { text: 'TSRP • TS27 Roleplay Server' }
        }]
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── جلب أعضاء السيرفر ─────────────────────────────────────
app.get('/discord-members', async (req, res) => {
  try {
    if (!BOT_TOKEN || !GUILD_ID) return res.status(500).json({ error: 'BOT_TOKEN or GUILD_ID not set' });

    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });

    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── جلب معلومات مستخدم ────────────────────────────────────
app.get("/discord-user", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "id required" });
    if (!BOT_TOKEN) return res.status(500).json({ error: "BOT_TOKEN not set" });
    const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── التحقق من Steam OpenID ─────────────────────────────────
app.post('/steam-verify', async (req, res) => {
  try {
    const { params } = req.body;
    if (!params) return res.status(400).json({ error: 'params required' });

    // بناء query string للتحقق
    const verifyParams = { ...params };
    verifyParams['openid.mode'] = 'check_authentication';

    const queryString = Object.entries(verifyParams)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');

    const r = await fetch('https://steamcommunity.com/openid/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryString
    });

    const text = await r.text();
    const valid = text.includes('is_valid:true');
    res.json({ valid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── txAdmin Proxy ──────────────────────────────────────────
app.post('/txadmin-proxy', async (req, res) => {
  try {
    const { txUrl, txToken, action, playerId, reason, duration, message } = req.body;
    if (!txUrl || !txToken) return res.status(400).json({ error: 'txUrl and txToken required' });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`:${txToken}`).toString('base64')}`
    };

    // جلب قائمة اللاعبين
    if (action === 'players') {
      const r = await fetch(`${txUrl}/players/list`, { headers });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      const data = await r.json();
      return res.json({ players: data.players || data.data || data || [] });
    }

    // التحقق من الاتصال
    if (action === 'status') {
      const r = await fetch(`${txUrl}/status`, { headers });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.json({ success: true, ...(await r.json()) });
    }

    // تحذير
    if (action === 'warn') {
      const r = await fetch(`${txUrl}/players/action`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'warn', id: playerId, reason: reason || 'تحذير من الإدارة' })
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.json({ success: true });
    }

    // طرد
    if (action === 'kick') {
      const r = await fetch(`${txUrl}/players/action`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'kick', id: playerId, reason: reason || 'طرد من الإدارة' })
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.json({ success: true });
    }

    // حظر
    if (action === 'ban') {
      const r = await fetch(`${txUrl}/players/action`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'ban', id: playerId, reason: reason || 'حظر من الإدارة', duration: duration || 'permanent' })
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.json({ success: true });
    }

    // رسالة
    if (action === 'message') {
      const r = await fetch(`${txUrl}/players/action`, {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'message', id: playerId, message: message || '' })
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Health check ───────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'TSRP Discord Bridge' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
