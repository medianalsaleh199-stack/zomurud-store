const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

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
`);

if (!db.prepare("SELECT COUNT(*) c FROM products").get().c) {
  const a = require("./seed.json");

  const q = db.prepare(`
    INSERT INTO products
    (name_ar,name_en,category,price,compare_price,stock,
     description_ar,description_en,image)
    VALUES(?,?,?,?,?,?,?,?,?)
  `);

  a.forEach(p =>
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
    )
  );
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   CLOUDINARY
========================= */

const cloudinaryReady =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  console.log("Cloudinary connected");
} else {
  console.log("WARNING: Cloudinary environment variables are missing.");
}

/* =========================
   IMAGE UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  }
});

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "zomurud-store/products",
        resource_type: "image"
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    stream.end(buffer);
  });
}

app.post(
  "/api/admin/upload-image",
  upload.array("images", 10),
  async (req, res) => {
    try {
      if (!cloudinaryReady) {
        return res.status(500).json({
          error: "Cloudinary غير مربوط. أضف متغيرات Cloudinary في Render."
        });
      }

      if (!req.files || !req.files.length) {
        return res.status(400).json({
          error: "لم يتم اختيار صورة."
        });
      }

      const results = [];

      for (const file of req.files) {
        const result = await uploadToCloudinary(file.buffer);

        results.push({
          url: result.secure_url,
          public_id: result.public_id
        });
      }

      res.json({
        ok: true,
        images: results,
        image: results[0]?.url || ""
      });

    } catch (error) {
      console.error("Cloudinary upload error:", error);

      res.status(500).json({
        error: "فشل رفع الصور إلى Cloudinary.",
        details: error.message
      });
    }
  }
);

/* =========================
   PRODUCTS
========================= */

app.get("/api/products", (req, res) => {
  res.json(
    db.prepare(`
      SELECT * FROM products
      WHERE active=1
      ORDER BY id DESC
    `).all()
  );
});

app.get("/api/stats", (req, res) => {
  res.json({
    revenue:
      db.prepare(`
        SELECT COALESCE(SUM(total),0) x
        FROM orders
        WHERE status!='CANCELLED'
      `).get().x,

    orders:
      db.prepare(`
        SELECT COUNT(*) x FROM orders
      `).get().x,

    customers:
      db.prepare(`
        SELECT COUNT(DISTINCT phone) x FROM orders
      `).get().x,

    products:
      db.prepare(`
        SELECT COUNT(*) x
        FROM products
        WHERE active=1
      `).get().x,

    low:
      db.prepare(`
        SELECT COUNT(*) x
        FROM products
        WHERE active=1 AND stock<=3
      `).get().x
  });
});

app.post("/api/products", (req, res) => {
  const p = req.body;

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

  const r = db.prepare(`
    INSERT INTO products
    (name_ar,name_en,category,price,compare_price,stock,
     description_ar,description_en,image)
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
    id: r.lastInsertRowid
  });
});

app.put("/api/products/:id", (req, res) => {
  const p = req.body;

  db.prepare(`
    UPDATE products SET
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

  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  db.prepare(`
    UPDATE products SET active=0
    WHERE id=?
  `).run(req.params.id);

  res.json({ ok: true });
});

/* =========================
   ORDERS
========================= */

app.get("/api/orders", (req, res) => {
  res.json(
    db.prepare(`
      SELECT * FROM orders
      ORDER BY id DESC
    `).all()
  );
});

app.post("/api/orders", (req, res) => {
  const {
    customer_name,
    phone,
    city,
    notes,
    items,
    total
  } = req.body;

  if (!customer_name || !phone || !items?.length) {
    return res.status(400).json({
      error: "البيانات ناقصة"
    });
  }

  const no = "ZM-" + Date.now().toString().slice(-9);

  const tx = db.transaction(() => {

    for (const i of items) {
      const p = db.prepare(`
        SELECT stock
        FROM products
        WHERE id=? AND active=1
      `).get(i.id);

      if (!p || p.stock < i.qty) {
        throw Error("المخزون غير كاف");
      }
    }

    for (const i of items) {
      db.prepare(`
        UPDATE products
        SET stock=stock-?
        WHERE id=?
      `).run(i.qty, i.id);
    }

    return db.prepare(`
      INSERT INTO orders
      (order_no,customer_name,phone,city,notes,items_json,total)
      VALUES(?,?,?,?,?,?,?)
    `).run(
      no,
      customer_name,
      phone,
      city || "",
      notes || "",
      JSON.stringify(items),
      Number(total) || 0
    );
  });

  try {
    tx();

    res.json({
      order_no: no
    });

  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});

app.patch("/api/orders/:id", (req, res) => {
  const allowed = [
    "NEW",
    "CONFIRMED",
    "PROCESSING",
    "READY",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED"
  ];

  if (!allowed.includes(req.body.status)) {
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

  res.json({ ok: true });
});

/* =========================
   PDF INVOICE
========================= */

app.get("/api/invoice/:id", (req, res) => {
  const o = db.prepare(`
    SELECT * FROM orders
    WHERE id=?
  `).get(req.params.id);

  if (!o) {
    return res.status(404).send("Not found");
  }

  const d = new PDFDocument({
    size: "A4",
    margin: 45
  });

  res.setHeader(
    "Content-Type",
    "application/pdf"
  );

  res.setHeader(
    "Content-Disposition",
    `inline; filename="${o.order_no}.pdf"`
  );

  d.pipe(res);

  d.fontSize(25).text("ZOMURUD");

  d.fontSize(11)
    .fillColor("#555")
    .text("الزمرد | Sales Invoice");

  d.fillColor("#111")
    .text(`Invoice: ${o.order_no}`)
    .text(
      `Date: ${new Date(o.created_at).toLocaleDateString("en-GB")}`
    )
    .moveDown();

  d.text(`Customer: ${o.customer_name}`)
    .text(`Phone: ${o.phone}`)
    .text(`City: ${o.city || ""}`)
    .moveDown();

  let y = d.y + 15;

  d.text("Product", 55, y)
    .text("Qty", 350, y)
    .text("Unit", 405, y)
    .text("Total", 480, y);

  y += 25;

  for (const i of JSON.parse(o.items_json)) {
    d.text(String(i.name).slice(0, 38), 55, y)
      .text(String(i.qty), 350, y)
      .text(`AED ${Number(i.price).toFixed(2)}`, 405, y)
      .text(
        `AED ${(Number(i.price) * i.qty).toFixed(2)}`,
        480,
        y
      );

    y += 25;
  }

  d.moveDown(2)
    .fontSize(15)
    .text(
      `TOTAL: AED ${Number(o.total).toFixed(2)}`,
      370,
      d.y,
      { align: "right" }
    );

  d.end();
});

/* =========================
   ADMIN
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public/admin.html")
  );
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public/index.html")
  );
});

app.listen(PORT, () => {
  console.log(`ZOMURUD Store running on port ${PORT}`);
});