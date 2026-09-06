const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");
const crypto = require("crypto");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();

const PORT = process.env.PORT || 10000;

/* =========================================================
   CLOUDINARY
========================================================= */

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (
  CLOUDINARY_CLOUD_NAME &&
  CLOUDINARY_API_KEY &&
  CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });

  console.log("Cloudinary configured:", CLOUDINARY_CLOUD_NAME);
} else {
  console.warn("WARNING: Cloudinary environment variables are missing.");
}

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   DATABASE
========================================================= */

const db = new Database(path.join(__dirname, "zomurud.db"));

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT,
  price REAL DEFAULT 0,
  compare_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  description_ar TEXT,
  description_en TEXT,
  image TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  public_id TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name_ar TEXT,
  name_en TEXT,
  required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_option_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_id INTEGER NOT NULL,
  label_ar TEXT,
  label_en TEXT,
  price_delta REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,
  customer_name TEXT,
  phone TEXT,
  city TEXT,
  notes TEXT,
  items_json TEXT,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================================================
   MULTER
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  }
});

/* =========================================================
   ADMIN AUTH
========================================================= */

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "admin@zomurud.com";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "change-this-password";

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");

  db.prepare(`
    INSERT INTO admin_sessions (token)
    VALUES (?)
  `).run(token);

  return token;
}

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token || req.headers["x-admin-token"];

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const session = db.prepare(`
      SELECT * FROM admin_sessions
      WHERE token = ?
    `).get(token);

    if (!session) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    req.admin = true;
    next();
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Authentication error"
    });
  }
}

/* =========================================================
   COOKIE PARSER
========================================================= */

app.use((req, res, next) => {
  const header = req.headers.cookie || "";

  const cookies = {};

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  });

  req.cookies = cookies;

  next();
});

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      String(email || "").trim() !== ADMIN_EMAIL ||
      String(password || "") !== ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    const token = createSession();

    res.setHeader(
      "Set-Cookie",
      `admin_token=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`
    );

    res.json({
      ok: true
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Login failed"
    });
  }
});

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.cookies.admin_token;

  if (token) {
    db.prepare(`
      DELETE FROM admin_sessions
      WHERE token = ?
    `).run(token);
  }

  res.setHeader(
    "Set-Cookie",
    "admin_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );

  res.json({
    ok: true
  });
});

/* =========================================================
   ADMIN ME
========================================================= */

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    admin: true
  });
});

/* =========================================================
   CLOUDINARY IMAGE UPLOAD
========================================================= */

app.post(
  "/api/admin/upload-image",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!CLOUDINARY_CLOUD_NAME) {
        return res.status(500).json({
          error: "Cloudinary cloud name is missing."
        });
      }

      if (!CLOUDINARY_API_KEY) {
        return res.status(500).json({
          error: "Cloudinary API key is missing."
        });
      }

      if (!CLOUDINARY_API_SECRET) {
        return res.status(500).json({
          error: "Cloudinary API secret is missing."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No image uploaded."
        });
      }

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "zomurud-store/products",
            resource_type: "image"
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        );

        stream.end(req.file.buffer);
      });

      res.json({
        ok: true,
        secure_url: result.secure_url,
        public_id: result.public_id,
        width: result.width,
        height: result.height
      });
    } catch (err) {
      console.error("Cloudinary upload error:", err);

      res.status(500).json({
        error:
          err?.message ||
          "Cloudinary upload failed."
      });
    }
  }
);

/* =========================================================
   PUBLIC PRODUCTS
========================================================= */

app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare(`
      SELECT *
      FROM products
      WHERE active = 1
      ORDER BY id DESC
    `).all();

    const result = products.map((product) => {
      const images = db.prepare(`
        SELECT *
        FROM product_images
        WHERE product_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(product.id);

      const options = db.prepare(`
        SELECT *
        FROM product_options
        WHERE product_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(product.id);

      const optionsWithValues = options.map((option) => {
        const values = db.prepare(`
          SELECT *
          FROM product_option_values
          WHERE option_id = ?
          ORDER BY sort_order ASC, id ASC
        `).all(option.id);

        return {
          ...option,
          values
        };
      });

      return {
        ...product,
        images,
        options: optionsWithValues
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load products."
    });
  }
});

/* =========================================================
   PUBLIC SINGLE PRODUCT
========================================================= */

app.get("/api/products/:id", (req, res) => {
  try {
    const product = db.prepare(`
      SELECT *
      FROM products
      WHERE id = ?
      AND active = 1
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const images = db.prepare(`
      SELECT *
      FROM product_images
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(product.id);

    const options = db.prepare(`
      SELECT *
      FROM product_options
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(product.id);

    const optionsWithValues = options.map((option) => {
      const values = db.prepare(`
        SELECT *
        FROM product_option_values
        WHERE option_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(option.id);

      return {
        ...option,
        values
      };
    });

    res.json({
      ...product,
      images,
      options: optionsWithValues
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load product."
    });
  }
});

/* =========================================================
   ADMIN PRODUCTS
========================================================= */

app.get("/api/admin/products", requireAdmin, (req, res) => {
  try {
    const products = db.prepare(`
      SELECT *
      FROM products
      ORDER BY id DESC
    `).all();

    const result = products.map((product) => {
      const images = db.prepare(`
        SELECT *
        FROM product_images
        WHERE product_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(product.id);

      const options = db.prepare(`
        SELECT *
        FROM product_options
        WHERE product_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(product.id);

      const optionsWithValues = options.map((option) => {
        const values = db.prepare(`
          SELECT *
          FROM product_option_values
          WHERE option_id = ?
          ORDER BY sort_order ASC, id ASC
        `).all(option.id);

        return {
          ...option,
          values
        };
      });

      return {
        ...product,
        images,
        options: optionsWithValues
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load admin products."
    });
  }
});

/* =========================================================
   ADMIN GET PRODUCT
========================================================= */

app.get("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const product = db.prepare(`
      SELECT *
      FROM products
      WHERE id = ?
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const images = db.prepare(`
      SELECT *
      FROM product_images
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(product.id);

    const options = db.prepare(`
      SELECT *
      FROM product_options
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(product.id);

    const optionsWithValues = options.map((option) => {
      const values = db.prepare(`
        SELECT *
        FROM product_option_values
        WHERE option_id = ?
        ORDER BY sort_order ASC, id ASC
      `).all(option.id);

      return {
        ...option,
        values
      };
    });

    res.json({
      ...product,
      images,
      options: optionsWithValues
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load product."
    });
  }
});

/* =========================================================
   CREATE PRODUCT
========================================================= */

app.post("/api/admin/products", requireAdmin, (req, res) => {
  try {
    const body = req.body || {};

    const name_ar = body.name_ar || "";
    const name_en = body.name_en || "";
    const category = body.category || "";
    const price = Number(body.price || 0);
    const compare_price = Number(body.compare_price || 0);
    const stock = Number(body.stock || 0);
    const description_ar = body.description_ar || "";
    const description_en = body.description_en || "";
    const active = body.active === false ? 0 : 1;

    if (!name_ar && !name_en) {
      return res.status(400).json({
        error: "Product name is required."
      });
    }

    const images = Array.isArray(body.images)
      ? body.images
      : [];

    const mainImage =
      body.image ||
      images[0]?.url ||
      "";

    const insertProduct = db.prepare(`
      INSERT INTO products (
        name_ar,
        name_en,
        category,
        price,
        compare_price,
        stock,
        description_ar,
        description_en,
        image,
        active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertProduct.run(
      name_ar,
      name_en,
      category,
      price,
      compare_price,
      stock,
      description_ar,
      description_en,
      mainImage,
      active
    );

    const productId = result.lastInsertRowid;

    saveImagesAndOptions(
      productId,
      images,
      body.options
    );

    res.json({
      ok: true,
      id: productId
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message || "Failed to create product."
    });
  }
});

/* =========================================================
   UPDATE PRODUCT
========================================================= */

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = db.prepare(`
      SELECT *
      FROM products
      WHERE id = ?
    `).get(id);

    if (!existing) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    const body = req.body || {};

    const name_ar = body.name_ar || "";
    const name_en = body.name_en || "";
    const category = body.category || "";
    const price = Number(body.price || 0);
    const compare_price = Number(body.compare_price || 0);
    const stock = Number(body.stock || 0);
    const description_ar = body.description_ar || "";
    const description_en = body.description_en || "";
    const active = body.active === false ? 0 : 1;

    const images = Array.isArray(body.images)
      ? body.images
      : [];

    const mainImage =
      body.image ||
      images[0]?.url ||
      existing.image ||
      "";

    db.prepare(`
      UPDATE products
      SET
        name_ar = ?,
        name_en = ?,
        category = ?,
        price = ?,
        compare_price = ?,
        stock = ?,
        description_ar = ?,
        description_en = ?,
        image = ?,
        active = ?
      WHERE id = ?
    `).run(
      name_ar,
      name_en,
      category,
      price,
      compare_price,
      stock,
      description_ar,
      description_en,
      mainImage,
      active,
      id
    );

    db.prepare(`
      DELETE FROM product_option_values
      WHERE option_id IN (
        SELECT id
        FROM product_options
        WHERE product_id = ?
      )
    `).run(id);

    db.prepare(`
      DELETE FROM product_options
      WHERE product_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM product_images
      WHERE product_id = ?
    `).run(id);

    saveImagesAndOptions(
      id,
      images,
      body.options
    );

    res.json({
      ok: true,
      id
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message || "Failed to update product."
    });
  }
});

/* =========================================================
   SAVE IMAGES + OPTIONS
========================================================= */

function saveImagesAndOptions(productId, images, options) {
  const insertImage = db.prepare(`
    INSERT INTO product_images (
      product_id,
      url,
      public_id,
      sort_order
    )
    VALUES (?, ?, ?, ?)
  `);

  if (Array.isArray(images)) {
    images.forEach((img, index) => {
      if (!img || !img.url) return;

      insertImage.run(
        productId,
        img.url,
        img.public_id || "",
        index
      );
    });
  }

  const insertOption = db.prepare(`
    INSERT INTO product_options (
      product_id,
      name_ar,
      name_en,
      required,
      sort_order
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertValue = db.prepare(`
    INSERT INTO product_option_values (
      option_id,
      label_ar,
      label_en,
      price_delta,
      sort_order
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  if (Array.isArray(options)) {
    options.forEach((option, optionIndex) => {
      if (!option) return;

      const optionResult = insertOption.run(
        productId,
        option.name_ar || "",
        option.name_en || "",
        option.required ? 1 : 0,
        optionIndex
      );

      const optionId = optionResult.lastInsertRowid;

      if (Array.isArray(option.values)) {
        option.values.forEach((value, valueIndex) => {
          insertValue.run(
            optionId,
            value.label_ar || "",
            value.label_en || "",
            Number(value.price_delta || 0),
            valueIndex
          );
        });
      }
    });
  }
}

/* =========================================================
   DELETE PRODUCT
========================================================= */

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);

    db.prepare(`
      DELETE FROM product_option_values
      WHERE option_id IN (
        SELECT id
        FROM product_options
        WHERE product_id = ?
      )
    `).run(id);

    db.prepare(`
      DELETE FROM product_options
      WHERE product_id = ?
    `).run(id);

    db.prepare(`
      DELETE FROM product_images
      WHERE product_id = ?
    `).run(id);

    const result = db.prepare(`
      DELETE FROM products
      WHERE id = ?
    `).run(id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Product not found."
      });
    }

    res.json({
      ok: true
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to delete product."
    });
  }
});

/* =========================================================
   STATS
========================================================= */

app.get("/api/stats", requireAdmin, (req, res) => {
  try {
    const products = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
    `).get().count;

    const activeProducts = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE active = 1
    `).get().count;

    const orders = db.prepare(`
      SELECT COUNT(*) AS count
      FROM orders
    `).get().count;

    const pendingOrders = db.prepare(`
      SELECT COUNT(*) AS count
      FROM orders
      WHERE status IN ('new','pending')
    `).get().count;

    const revenue = db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total
      FROM orders
      WHERE status != 'cancelled'
    `).get().total;

    res.json({
      products,
      activeProducts,
      orders,
      pendingOrders,
      revenue
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load statistics."
    });
  }
});

/* =========================================================
   ORDERS
========================================================= */

app.get("/api/orders", requireAdmin, (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT *
      FROM orders
      ORDER BY id DESC
    `).all();

    res.json(orders);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load orders."
    });
  }
});

/* =========================================================
   CREATE ORDER
========================================================= */

app.post("/api/orders", (req, res) => {
  try {
    const body = req.body || {};

    const orderNo =
      "ZM-" +
      Date.now().toString(36).toUpperCase();

    const customerName =
      body.customer_name ||
      body.customerName ||
      "";

    const phone =
      body.phone ||
      "";

    const city =
      body.city ||
      "";

    const notes =
      body.notes ||
      "";

    const items =
      Array.isArray(body.items)
        ? body.items
        : [];

    const total =
      Number(body.total || 0);

    db.prepare(`
      INSERT INTO orders (
        order_no,
        customer_name,
        phone,
        city,
        notes,
        items_json,
        total,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderNo,
      customerName,
      phone,
      city,
      notes,
      JSON.stringify(items),
      total,
      "new"
    );

    res.json({
      ok: true,
      order_no: orderNo
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to create order."
    });
  }
});

/* =========================================================
   UPDATE ORDER STATUS
========================================================= */

app.patch("/api/orders/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status || "new";

    const allowed = [
      "new",
      "pending",
      "processing",
      "ready",
      "delivered",
      "cancelled"
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: "Invalid status."
      });
    }

    const result = db.prepare(`
      UPDATE orders
      SET status = ?
      WHERE id = ?
    `).run(status, id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    res.json({
      ok: true
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to update order."
    });
  }
});

/* =========================================================
   INVOICE PDF
========================================================= */

app.get("/api/orders/:id/invoice", requireAdmin, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT *
      FROM orders
      WHERE id = ?
    `).get(req.params.id);

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const doc = new PDFDocument({
      margin: 50
    });

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${order.order_no || "invoice"}.pdf"`
    );

    doc.pipe(res);

    doc
      .fontSize(24)
      .text("ZOMURUD", {
        align: "center"
      });

    doc.moveDown();

    doc
      .fontSize(18)
      .text("INVOICE", {
        align: "center"
      });

    doc.moveDown(2);

    doc.fontSize(11);

    doc.text(`Order: ${order.order_no || ""}`);
    doc.text(`Customer: ${order.customer_name || ""}`);
    doc.text(`Phone: ${order.phone || ""}`);
    doc.text(`City: ${order.city || ""}`);

    doc.moveDown();

    doc.text("Items:");

    let items = [];

    try {
      items = JSON.parse(order.items_json || "[]");
    } catch {
      items = [];
    }

    items.forEach((item, index) => {
      doc.moveDown(0.5);

      doc.text(
        `${index + 1}. ${
          item.name ||
          item.name_en ||
          item.name_ar ||
          "Product"
        }`
      );

      doc.text(
        `Qty: ${item.quantity || 1}    Price: ${item.price || 0}`
      );
    });

    doc.moveDown(2);

    doc
      .fontSize(16)
      .text(`TOTAL: ${Number(order.total || 0).toFixed(2)} AED`);

    doc.moveDown();

    doc
      .fontSize(10)
      .text("Thank you for choosing ZOMURUD.", {
        align: "center"
      });

    doc.end();
  } catch (err) {
    console.error(err);

    res.status(500).send("Invoice generation failed.");
  }
});

/* =========================================================
   ADMIN PAGES
========================================================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

app.get("/admin-login", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin-login.html")
  );
});

/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(
  path.join(__dirname, "public")
));

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "zomurud-store"
  });
});

/* =========================================================
   HOME
========================================================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: err.message || "Server error"
  });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log(
    `ZOMURUD Store running on port ${PORT}`
  );
});