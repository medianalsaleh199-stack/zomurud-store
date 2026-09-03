const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const db = new Database(path.join(__dirname, "zomurud.db"));

db.pragma("journal_mode=WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT,
  name_en TEXT,
  category TEXT,
  price REAL,
  compare_price REAL,
  stock INTEGER,
  description_ar TEXT,
  description_en TEXT,
  image TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,
  customer_name TEXT,
  phone TEXT,
  city TEXT,
  notes TEXT,
  items_json TEXT,
  total REAL,
  status TEXT DEFAULT 'NEW',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions(
  token TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================
   ADMIN SETTINGS
========================= */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.warn(
    "WARNING: ADMIN_EMAIL and ADMIN_PASSWORD are not configured in Render."
  );
}

/* =========================
   SEED PRODUCTS
========================= */

if (!db.prepare("SELECT COUNT(*) c FROM products").get().c) {
  const seed = require("./seed.json");

  const q = db.prepare(`
    INSERT INTO products(
      name_ar,
      name_en,
      category,
      price,
      compare_price,
      stock,
      description_ar,
      description_en,
      image
    )
    VALUES(?,?,?,?,?,?,?,?,?)
  `);

  seed.forEach((p) => {
    q.run(
      p[0],
      p[1],
      p[2],
      p[3],
      p[4],
      p[5],
      "حلول عرض احترافية من الزمرد.",
      "Professional ZOMURUD display solution.",
      ""
    );
  });
}

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json({ limit: "5mb" }));

/* =========================
   SESSION FUNCTIONS
========================= */

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");

  db.prepare(`
    INSERT INTO admin_sessions(token)
    VALUES(?)
  `).run(token);

  return token;
}

function deleteSession(token) {
  if (!token) return;

  db.prepare(`
    DELETE FROM admin_sessions
    WHERE token=?
  `).run(token);
}

function isAdmin(req) {
  const token = req.cookies?.zomurud_admin;

  if (!token) return false;

  const session = db.prepare(`
    SELECT token
    FROM admin_sessions
    WHERE token=?
    AND datetime(created_at) > datetime('now','-7 days')
  `).get(token);

  return !!session;
}

/* =========================
   COOKIE PARSER
========================= */

app.use((req, res, next) => {
  req.cookies = {};

  const header = req.headers.cookie || "";

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    req.cookies[key] = decodeURIComponent(value);
  });

  next();
});

/* =========================
   ADMIN LOGIN PAGE
========================= */

app.get("/admin-login.html", (req, res) => {
  if (isAdmin(req)) {
    return res.redirect("/admin.html");
  }

  res.sendFile(
    path.join(__dirname, "public", "admin-login.html")
  );
});

/* =========================
   PROTECT ADMIN PAGE
========================= */

app.get("/admin.html", (req, res) => {
  if (!isAdmin(req)) {
    return res.redirect("/admin-login.html");
  }

  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

app.get("/admin", (req, res) => {
  if (!isAdmin(req)) {
    return res.redirect("/admin-login.html");
  }

  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

/* =========================
   ADMIN LOGIN API
========================= */

app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({
      error: "Admin login is not configured on the server."
    });
  }

  if (
    email !== ADMIN_EMAIL ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    });
  }

  const token = createSession();

  res.cookie("zomurud_admin", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });

  res.json({
    ok: true
  });
});

/* =========================
   ADMIN LOGOUT
========================= */

app.post("/api/admin/logout", (req, res) => {
  deleteSession(req.cookies?.zomurud_admin);

  res.clearCookie("zomurud_admin", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
  });

  res.json({
    ok: true
  });
});

/* =========================
   CHECK ADMIN LOGIN
========================= */

app.get("/api/admin/me", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      authenticated: false
    });
  }

  res.json({
    authenticated: true,
    email: ADMIN_EMAIL
  });
});

/* =========================
   PUBLIC PRODUCTS
========================= */

app.get("/api/products", (req, res) => {
  res.json(
    db.prepare(`
      SELECT *
      FROM products
      WHERE active=1
      ORDER BY id DESC
    `).all()
  );
});

/* =========================
   ADMIN STATS
========================= */

app.get("/api/stats", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  res.json({
    revenue: db.prepare(`
      SELECT COALESCE(SUM(total),0) x
      FROM orders
      WHERE status!='CANCELLED'
    `).get().x,

    orders: db.prepare(`
      SELECT COUNT(*) x
      FROM orders
    `).get().x,

    customers: db.prepare(`
      SELECT COUNT(DISTINCT phone) x
      FROM orders
    `).get().x,

    products: db.prepare(`
      SELECT COUNT(*) x
      FROM products
      WHERE active=1
    `).get().x,

    low: db.prepare(`
      SELECT COUNT(*) x
      FROM products
      WHERE active=1
      AND stock<=3
    `).get().x
  });
});

/* =========================
   ADD PRODUCT
========================= */

app.post("/api/products", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const p = req.body || {};

  if (
    !p.name_ar ||
    !p.name_en ||
    !p.category ||
    Number(p.price) < 0
  ) {
    return res.status(400).json({
      error: "بيانات المنتج ناقصة"
    });
  }

  const result = db.prepare(`
    INSERT INTO products(
      name_ar,
      name_en,
      category,
      price,
      compare_price,
      stock,
      description_ar,
      description_en,
      image
    )
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    p.name_ar,
    p.name_en,
    p.category,
    Number(p.price),
    Number(p.compare_price) || 0,
    Number(p.stock) || 0,
    p.description_ar || "",
    p.description_en || "",
    p.image || ""
  );

  res.json({
    id: result.lastInsertRowid
  });
});

/* =========================
   UPDATE PRODUCT
========================= */

app.put("/api/products/:id", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const p = req.body || {};

  db.prepare(`
    UPDATE products
    SET
      name_ar=?,
      name_en=?,
      category=?,
      price=?,
      compare_price=?,
      stock=?,
      description_ar=?,
      description_en=?,
      image=?
    WHERE id=?
  `).run(
    p.name_ar,
    p.name_en,
    p.category,
    Number(p.price),
    Number(p.compare_price) || 0,
    Number(p.stock) || 0,
    p.description_ar || "",
    p.description_en || "",
    p.image || "",
    req.params.id
  );

  res.json({
    ok: true
  });
});

/* =========================
   DELETE PRODUCT
========================= */

app.delete("/api/products/:id", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  db.prepare(`
    UPDATE products
    SET active=0
    WHERE id=?
  `).run(req.params.id);

  res.json({
    ok: true
  });
});

/* =========================
   GET ORDERS - ADMIN
========================= */

app.get("/api/orders", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  res.json(
    db.prepare(`
      SELECT *
      FROM orders
      ORDER BY id DESC
    `).all()
  );
});

/* =========================
   CREATE ORDER - PUBLIC
========================= */

app.post("/api/orders", (req, res) => {
  const {
    customer_name,
    phone,
    city,
    notes,
    items,
    total
  } = req.body || {};

  if (
    !customer_name ||
    !phone ||
    !items?.length
  ) {
    return res.status(400).json({
      error: "البيانات ناقصة"
    });
  }

  const orderNo =
    "ZM-" +
    Date.now()
      .toString()
      .slice(-9);

  const transaction = db.transaction(() => {

    for (const item of items) {
      const product = db.prepare(`
        SELECT stock
        FROM products
        WHERE id=?
        AND active=1
      `).get(item.id);

      if (
        !product ||
        product.stock < Number(item.qty)
      ) {
        throw new Error(
          "المخزون غير كاف"
        );
      }
    }

    for (const item of items) {
      db.prepare(`
        UPDATE products
        SET stock=stock-?
        WHERE id=?
      `).run(
        Number(item.qty),
        item.id
      );
    }

    return db.prepare(`
      INSERT INTO orders(
        order_no,
        customer_name,
        phone,
        city,
        notes,
        items_json,
        total
      )
      VALUES(?,?,?,?,?,?,?)
    `).run(
      orderNo,
      customer_name,
      phone,
      city || "",
      notes || "",
      JSON.stringify(items),
      Number(total) || 0
    );
  });

  try {
    transaction();

    res.json({
      order_no: orderNo
    });

  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

/* =========================
   UPDATE ORDER STATUS - ADMIN
========================= */

app.patch("/api/orders/:id", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const allowedStatuses = [
    "NEW",
    "CONFIRMED",
    "PROCESSING",
    "READY",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED"
  ];

  if (
    !allowedStatuses.includes(
      req.body.status
    )
  ) {
    return res.status(400).json({
      error: "invalid status"
    });
  }

  db.prepare(`
    UPDATE orders
    SET status=?
    WHERE id=?
  `).run(
    req.body.status,
    req.params.id
  );

  res.json({
    ok: true
  });
});

/* =========================
   PDF INVOICE
========================= */

app.get("/api/invoice/:id", (req, res) => {

  const order = db.prepare(`
    SELECT *
    FROM orders
    WHERE id=?
  `).get(req.params.id);

  if (!order) {
    return res.status(404).send("Not found");
  }

  const doc = new PDFDocument({
    size: "A4",
    margin: 45
  });

  res.setHeader(
    "Content-Type",
    "application/pdf"
  );

  res.setHeader(
    "Content-Disposition",
    `inline; filename="${order.order_no}.pdf"`
  );

  doc.pipe(res);

  doc
    .fontSize(25)
    .text("ZOMURUD");

  doc
    .fontSize(11)
    .fillColor("#555")
    .text("الزمرد | Sales Invoice");

  doc
    .fillColor("#111")
    .text(`Invoice: ${order.order_no}`)
    .text(
      `Date: ${new Date(
        order.created_at
      ).toLocaleDateString("en-GB")}`
    )
    .moveDown();

  doc
    .text(`Customer: ${order.customer_name}`)
    .text(`Phone: ${order.phone}`)
    .text(`City: ${order.city || ""}`)
    .moveDown();

  let y = doc.y + 15;

  doc
    .text("Product", 55, y)
    .text("Qty", 350, y)
    .text("Unit", 405, y)
    .text("Total", 480, y);

  y += 25;

  for (
    const item of JSON.parse(
      order.items_json
    )
  ) {

    doc
      .text(
        String(item.name).slice(0, 38),
        55,
        y
      )
      .text(
        String(item.qty),
        350,
        y
      )
      .text(
        `AED ${Number(item.price).toFixed(2)}`,
        405,
        y
      )
      .text(
        `AED ${(Number(item.price) * Number(item.qty)).toFixed(2)}`,
        480,
        y
      );

    y += 25;
  }

  doc
    .moveDown(2)
    .fontSize(15)
    .text(
      `TOTAL: AED ${Number(order.total).toFixed(2)}`,
      370,
      doc.y,
      {
        align: "right"
      }
    );

  doc.end();
});

/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   HOME
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(
    `ZOMURUD STORE running on port ${PORT}`
  );
});