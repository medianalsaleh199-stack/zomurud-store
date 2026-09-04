const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");
const crypto = require("crypto");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

/* =========================
   CLOUDINARY
========================= */

cloudinary.config({
  secure: true
});

console.log(
  "Cloudinary configured:",
  process.env.CLOUDINARY_URL ? "YES" : "NO"
);

/* =========================
   DATABASE
========================= */

const db = new Database(
  path.join(__dirname, "zomurud.db")
);

db.pragma("journal_mode=WAL");

/* =========================
   DATABASE TABLES
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL DEFAULT 0,
  compare_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  description_ar TEXT DEFAULT '',
  description_en TEXT DEFAULT '',
  image TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_images(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_options(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  type TEXT DEFAULT 'select',
  required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_option_values(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_id INTEGER NOT NULL,
  label_ar TEXT NOT NULL,
  label_en TEXT NOT NULL,
  value TEXT DEFAULT '',
  price_delta REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,
  customer_name TEXT,
  phone TEXT,
  city TEXT,
  notes TEXT,
  items_json TEXT,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'NEW',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions(
  token TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================
   ADMIN
========================= */

const ADMIN_EMAIL =
  String(process.env.ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();

const ADMIN_PASSWORD =
  String(process.env.ADMIN_PASSWORD || "");

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.warn(
    "ADMIN_EMAIL / ADMIN_PASSWORD are missing."
  );
}

/* =========================
   SEED
========================= */

const productCount =
  db.prepare(
    "SELECT COUNT(*) c FROM products"
  ).get().c;

if (!productCount) {
  try {
    const seed = require("./seed.json");

    const insert = db.prepare(`
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

    for (const p of seed) {
      insert.run(
        p[0] || "منتج",
        p[1] || "Product",
        p[2] || "General",
        Number(p[3]) || 0,
        Number(p[4]) || 0,
        Number(p[5]) || 0,
        "حلول عرض احترافية من الزمرد.",
        "Professional ZOMURUD display solution.",
        ""
      );
    }
  } catch (e) {
    console.log("Seed error:", e.message);
  }
}

/* =========================
   MIDDLEWARE
========================= */

app.use(
  express.json({
    limit: "10mb"
  })
);

/* =========================
   COOKIE PARSER
========================= */

app.use((req, res, next) => {
  req.cookies = {};

  const header =
    req.headers.cookie || "";

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key =
      part.slice(0, index).trim();

    const value =
      part.slice(index + 1).trim();

    try {
      req.cookies[key] =
        decodeURIComponent(value);
    } catch {
      req.cookies[key] = value;
    }
  });

  next();
});

/* =========================
   AUTH
========================= */

function createSession() {
  const token =
    crypto.randomBytes(32).toString("hex");

  db.prepare(`
    INSERT INTO admin_sessions(token)
    VALUES(?)
  `).run(token);

  return token;
}

function removeSession(token) {
  if (!token) return;

  db.prepare(`
    DELETE FROM admin_sessions
    WHERE token=?
  `).run(token);
}

function isAdmin(req) {
  const token =
    req.cookies.zomurud_admin;

  if (!token) return false;

  const session =
    db.prepare(`
      SELECT token
      FROM admin_sessions
      WHERE token=?
      AND datetime(created_at)
      > datetime('now','-7 days')
    `).get(token);

  return !!session;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

/* =========================
   LOGIN
========================= */

app.post(
  "/api/admin/login",
  (req, res) => {

    const email =
      String(req.body?.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(req.body?.password || "");

    if (
      !ADMIN_EMAIL ||
      !ADMIN_PASSWORD
    ) {
      return res.status(500).json({
        error:
          "Admin login is not configured."
      });
    }

    if (
      email !== ADMIN_EMAIL ||
      password !== ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        error:
          "البريد الإلكتروني أو كلمة المرور غير صحيحة"
      });
    }

    const token =
      createSession();

    const secure =
      req.protocol === "https";

    res.setHeader(
      "Set-Cookie",
      [
        `zomurud_admin=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : ""
      ]
        .filter(Boolean)
        .join("; ")
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   LOGOUT
========================= */

app.post(
  "/api/admin/logout",
  (req, res) => {

    removeSession(
      req.cookies.zomurud_admin
    );

    res.setHeader(
      "Set-Cookie",
      "zomurud_admin=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   CHECK LOGIN
========================= */

app.get(
  "/api/admin/me",
  (req, res) => {

    if (!isAdmin(req)) {
      return res.status(401).json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      email: ADMIN_EMAIL
    });
  }
);

/* =========================
   ADMIN PAGES
========================= */

app.get(
  "/admin-login.html",
  (req, res) => {

    if (isAdmin(req)) {
      return res.redirect(
        "/admin.html"
      );
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin-login.html"
      )
    );
  }
);

app.get(
  "/admin.html",
  (req, res) => {

    if (!isAdmin(req)) {
      return res.redirect(
        "/admin-login.html"
      );
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

app.get(
  "/admin",
  (req, res) => {

    if (!isAdmin(req)) {
      return res.redirect(
        "/admin-login.html"
      );
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

/* =========================
   CLOUDINARY IMAGE UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error(
          "يسمح فقط بصور JPG و PNG و WEBP"
        )
      );
    }

    cb(null, true);
  }
});

/*
  Upload image from admin phone
  POST /api/admin/upload-image
*/

app.post(
  "/api/admin/upload-image",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {

    try {

      if (!process.env.CLOUDINARY_URL) {
        return res.status(500).json({
          error:
            "CLOUDINARY_URL غير موجود في Render"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error:
            "لم يتم اختيار صورة"
        });
      }

      const result =
        await new Promise(
          (resolve, reject) => {

            const stream =
              cloudinary.uploader.upload_stream(
                {
                  folder:
                    "zomurud/products",
                  resource_type:
                    "image"
                },
                (error, result) => {

                  if (error) {
                    return reject(
                      error
                    );
                  }

                  resolve(result);
                }
              );

            stream.end(
              req.file.buffer
            );
          }
        );

      res.json({
        ok: true,
        url: result.secure_url,
        secure_url: result.secure_url,
        public_id: result.public_id
      });

    } catch (error) {

      console.error(
        "Cloudinary upload error:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "فشل رفع الصورة إلى Cloudinary"
      });
    }
  }
);

/* =========================
   PRODUCT HELPERS
========================= */

function getImages(productId) {
  return db.prepare(`
    SELECT
      id,
      image_url,
      sort_order
    FROM product_images
    WHERE product_id=?
    ORDER BY sort_order ASC,id ASC
  `).all(productId);
}

function getOptions(productId) {

  const options =
    db.prepare(`
      SELECT
        id,
        name_ar,
        name_en,
        type,
        required,
        sort_order
      FROM product_options
      WHERE product_id=?
      ORDER BY sort_order ASC,id ASC
    `).all(productId);

  for (const option of options) {

    option.required =
      Boolean(option.required);

    option.values =
      db.prepare(`
        SELECT
          id,
          label_ar,
          label_en,
          value,
          price_delta,
          sort_order
        FROM product_option_values
        WHERE option_id=?
        ORDER BY sort_order ASC,id ASC
      `).all(option.id);
  }

  return options;
}

function fullProduct(id) {

  const product =
    db.prepare(`
      SELECT *
      FROM products
      WHERE id=?
    `).get(id);

  if (!product) return null;

  product.images =
    getImages(id);

  product.options =
    getOptions(id);

  return product;
}

function allProducts(activeOnly = true) {

  const products =
    db.prepare(
      activeOnly
        ? `
          SELECT *
          FROM products
          WHERE active=1
          ORDER BY id DESC
        `
        : `
          SELECT *
          FROM products
          ORDER BY id DESC
        `
    ).all();

  for (const product of products) {

    product.images =
      getImages(product.id);

    product.options =
      getOptions(product.id);
  }

  return products;
}

/* =========================
   PUBLIC PRODUCTS
========================= */

app.get(
  "/api/products",
  (req, res) => {
    res.json(
      allProducts(true)
    );
  }
);

app.get(
  "/api/products/:id",
  (req, res) => {

    const product =
      fullProduct(req.params.id);

    if (
      !product ||
      !product.active
    ) {
      return res.status(404).json({
        error:
          "Product not found"
      });
    }

    res.json(product);
  }
);

/* =========================
   ADMIN PRODUCTS
========================= */

app.get(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    res.json(
      allProducts(false)
    );
  }
);

/* =========================
   STATS
========================= */

app.get(
  "/api/stats",
  requireAdmin,
  (req, res) => {

    const revenue =
      db.prepare(`
        SELECT COALESCE(
          SUM(total),0
        ) x
        FROM orders
        WHERE status!='CANCELLED'
      `).get().x;

    const orders =
      db.prepare(`
        SELECT COUNT(*) x
        FROM orders
      `).get().x;

    const customers =
      db.prepare(`
        SELECT COUNT(
          DISTINCT phone
        ) x
        FROM orders
      `).get().x;

    const products =
      db.prepare(`
        SELECT COUNT(*) x
        FROM products
        WHERE active=1
      `).get().x;

    const low =
      db.prepare(`
        SELECT COUNT(*) x
        FROM products
        WHERE active=1
        AND stock<=3
      `).get().x;

    res.json({
      revenue,
      orders,
      customers,
      products,
      low
    });
  }
);

/* =========================
   SAVE IMAGES
========================= */

function saveImages(
  productId,
  images
) {

  if (!Array.isArray(images)) {
    return;
  }

  const insert =
    db.prepare(`
      INSERT INTO product_images(
        product_id,
        image_url,
        sort_order
      )
      VALUES(?,?,?)
    `);

  images.forEach(
    (item, index) => {

      let url = "";

      if (
        typeof item === "string"
      ) {
        url = item;
      }

      if (
        item &&
        typeof item === "object"
      ) {
        url =
          item.image_url ||
          item.url ||
          item.secure_url ||
          "";
      }

      url =
        String(url).trim();

      if (!url) return;

      insert.run(
        productId,
        url,
        index
      );
    }
  );
}

/* =========================
   SAVE OPTIONS
========================= */

function saveOptions(
  productId,
  options
) {

  if (!Array.isArray(options)) {
    return;
  }

  const insertOption =
    db.prepare(`
      INSERT INTO product_options(
        product_id,
        name_ar,
        name_en,
        type,
        required,
        sort_order
      )
      VALUES(?,?,?,?,?,?)
    `);

  const insertValue =
    db.prepare(`
      INSERT INTO product_option_values(
        option_id,
        label_ar,
        label_en,
        value,
        price_delta,
        sort_order
      )
      VALUES(?,?,?,?,?,?)
    `);

  options.forEach(
    (option, optionIndex) => {

      if (!option) return;

      const nameAr =
        String(
          option.name_ar ||
          ""
        ).trim();

      const nameEn =
        String(
          option.name_en ||
          ""
        ).trim();

      if (!nameAr && !nameEn) {
        return;
      }

      const result =
        insertOption.run(
          productId,
          nameAr || nameEn,
          nameEn || nameAr,
          option.type ||
            "select",
          option.required ? 1 : 0,
          optionIndex
        );

      const optionId =
        Number(
          result.lastInsertRowid
        );

      const values =
        Array.isArray(
          option.values
        )
          ? option.values
          : [];

      values.forEach(
        (value, valueIndex) => {

          if (!value) return;

          const ar =
            String(
              value.label_ar ||
              value.label_en ||
              ""
            );

          const en =
            String(
              value.label_en ||
              value.label_ar ||
              ""
            );

          if (!ar && !en) {
            return;
          }

          insertValue.run(
            optionId,
            ar,
            en,
            String(
              value.value || ""
            ),
            Number(
              value.price_delta
            ) || 0,
            valueIndex
          );
        }
      );
    }
  );
}

function deleteOptions(productId) {

  const options =
    db.prepare(`
      SELECT id
      FROM product_options
      WHERE product_id=?
    `).all(productId);

  for (const option of options) {

    db.prepare(`
      DELETE FROM product_option_values
      WHERE option_id=?
    `).run(option.id);
  }

  db.prepare(`
    DELETE FROM product_options
    WHERE product_id=?
  `).run(productId);
}

/* =========================
   ADD PRODUCT
========================= */

app.post(
  "/api/products",
  requireAdmin,
  (req, res) => {

    const p =
      req.body || {};

    if (
      !p.name_ar ||
      !p.name_en ||
      !p.category
    ) {
      return res.status(400).json({
        error:
          "اسم المنتج والتصنيف مطلوبان"
      });
    }

    try {

      const transaction =
        db.transaction(() => {

          const result =
            db.prepare(`
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
              Number(p.price) || 0,
              Number(p.compare_price) || 0,
              Number(p.stock) || 0,
              p.description_ar || "",
              p.description_en || "",
              p.image || ""
            );

          const id =
            Number(
              result.lastInsertRowid
            );

          saveImages(
            id,
            p.images || []
          );

          saveOptions(
            id,
            p.options || []
          );

          return id;
        });

      const id =
        transaction();

      res.json({
        ok: true,
        id
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   UPDATE PRODUCT
========================= */

app.put(
  "/api/products/:id",
  requireAdmin,
  (req, res) => {

    const p =
      req.body || {};

    const id =
      req.params.id;

    try {

      const transaction =
        db.transaction(() => {

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
            p.name_ar || "",
            p.name_en || "",
            p.category || "",
            Number(p.price) || 0,
            Number(
              p.compare_price
            ) || 0,
            Number(p.stock) || 0,
            p.description_ar || "",
            p.description_en || "",
            p.image || "",
            id
          );

          if (
            Array.isArray(p.images)
          ) {

            db.prepare(`
              DELETE FROM product_images
              WHERE product_id=?
            `).run(id);

            saveImages(
              id,
              p.images
            );
          }

          if (
            Array.isArray(p.options)
          ) {

            deleteOptions(id);

            saveOptions(
              id,
              p.options
            );
          }
        });

      transaction();

      res.json({
        ok: true
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   DELETE PRODUCT
========================= */

app.delete(
  "/api/products/:id",
  requireAdmin,
  (req, res) => {

    db.prepare(`
      UPDATE products
      SET active=0
      WHERE id=?
    `).run(req.params.id);

    res.json({
      ok: true
    });
  }
);

/* =========================
   ORDERS
========================= */

app.get(
  "/api/orders",
  requireAdmin,
  (req, res) => {

    res.json(
      db.prepare(`
        SELECT *
        FROM orders
        ORDER BY id DESC
      `).all()
    );
  }
);

/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  (req, res) => {

    const {
      customer_name,
      phone,
      city,
      notes,
      items
    } = req.body || {};

    if (
      !customer_name ||
      !phone ||
      !Array.isArray(items) ||
      !items.length
    ) {
      return res.status(400).json({
        error:
          "البيانات ناقصة"
      });
    }

    const orderNo =
      "ZM-" +
      Date.now()
        .toString()
        .slice(-9);

    try {

      const transaction =
        db.transaction(() => {

          let calculatedTotal = 0;

          for (
            const item of items
          ) {

            const product =
              db.prepare(`
                SELECT
                  id,
                  price,
                  stock,
                  name_ar,
                  name_en
                FROM products
                WHERE id=?
                AND active=1
              `).get(item.id);

            if (!product) {
              throw new Error(
                "المنتج غير موجود"
              );
            }

            const qty =
              Math.max(
                1,
                Number(item.qty) || 1
              );

            if (
              product.stock < qty
            ) {
              throw new Error(
                "المخزون غير كاف"
              );
            }

            calculatedTotal +=
              (
                Number(
                  item.price ??
                  product.price
                ) || 0
              ) * qty;
          }

          for (
            const item of items
          ) {

            const qty =
              Math.max(
                1,
                Number(item.qty) || 1
              );

            db.prepare(`
              UPDATE products
              SET stock=stock-?
              WHERE id=?
            `).run(
              qty,
              item.id
            );
          }

          db.prepare(`
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
            calculatedTotal
          );
        });

      transaction();

      res.json({
        ok: true,
        order_no: orderNo
      });

    } catch (error) {

      console.error(error);

      res.status(400).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   ORDER STATUS
========================= */

app.patch(
  "/api/orders/:id",
  requireAdmin,
  (req, res) => {

    const statuses = [
      "NEW",
      "CONFIRMED",
      "PROCESSING",
      "READY",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED"
    ];

    if (
      !statuses.includes(
        req.body?.status
      )
    ) {
      return res.status(400).json({
        error:
          "invalid status"
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
  }
);

/* =========================
   INVOICE
========================= */

app.get(
  "/api/invoice/:id",
  (req, res) => {

    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE id=?
      `).get(req.params.id);

    if (!order) {
      return res
        .status(404)
        .send("Not found");
    }

    const doc =
      new PDFDocument({
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
      .fillColor("#111")
      .text("ZOMURUD");

    doc
      .fontSize(11)
      .fillColor("#555")
      .text(
        "الزمرد | Sales Invoice"
      );

    doc
      .fillColor("#111")
      .text(
        `Invoice: ${order.order_no}`
      )
      .text(
        `Date: ${new Date(
          order.created_at
        ).toLocaleDateString(
          "en-GB"
        )}`
      )
      .moveDown();

    doc
      .text(
        `Customer: ${order.customer_name}`
      )
      .text(
        `Phone: ${order.phone}`
      )
      .text(
        `City: ${order.city || ""}`
      )
      .moveDown();

    let y =
      doc.y + 15;

    doc
      .text("Product",55,y)
      .text("Qty",350,y)
      .text("Unit",405,y)
      .text("Total",480,y);

    y += 25;

    let items = [];

    try {
      items =
        JSON.parse(
          order.items_json
        );
    } catch {
      items = [];
    }

    for (
      const item of items
    ) {

      const qty =
        Number(item.qty) || 1;

      const price =
        Number(item.price) || 0;

      doc
        .text(
          String(
            item.name ||
            item.name_en ||
            item.name_ar ||
            ""
          ).slice(0,38),
          55,
          y
        )
        .text(
          String(qty),
          350,
          y
        )
        .text(
          `AED ${price.toFixed(2)}`,
          405,
          y
        )
        .text(
          `AED ${(price * qty).toFixed(2)}`,
          480,
          y
        );

      y += 25;
    }

    doc
      .moveDown(2)
      .fontSize(15)
      .text(
        `TOTAL: AED ${Number(
          order.total
        ).toFixed(2)}`,
        370,
        doc.y,
        {
          align:"right"
        }
      );

    doc.end();
  }
);

/* =========================
   STATIC
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

/* =========================
   HOME
========================= */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================
   START
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      `ZOMURUD STORE running on port ${PORT}`
    );
  }
);