
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "zomurud.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name_ar TEXT NOT NULL, name_en TEXT NOT NULL, category TEXT NOT NULL,
 price REAL NOT NULL, compare_price REAL DEFAULT 0, stock INTEGER DEFAULT 0,
 description_ar TEXT DEFAULT '', description_en TEXT DEFAULT '',
 image TEXT DEFAULT '', active INTEGER DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_no TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
 city TEXT DEFAULT '', notes TEXT DEFAULT '', items_json TEXT NOT NULL,
 total REAL NOT NULL, status TEXT DEFAULT 'NEW', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
const count = db.prepare("SELECT COUNT(*) c FROM products").get().c;
if (!count) {
 const ins=db.prepare(`INSERT INTO products(name_ar,name_en,category,price,compare_price,stock,description_ar,description_en,image) VALUES(?,?,?,?,?,?,?,?,?)`);
 const tx=db.transaction(items=>items.forEach(p=>ins.run(p.name_ar,p.name_en,p.category,p.price,p.compare_price,p.stock,p.description_ar,p.description_en,p.image)));
 tx(require("./seed.json"));
}
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/products",(req,res)=>{
 const rows=db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
 res.json(rows);
});
app.get("/api/categories",(req,res)=>{
 res.json(db.prepare("SELECT category,COUNT(*) count FROM products WHERE active=1 GROUP BY category ORDER BY category").all());
});
app.post("/api/products",(req,res)=>{
 const p=req.body;
 if(!p.name_ar||!p.name_en||!p.category||Number(p.price)<0) return res.status(400).json({error:"بيانات المنتج غير مكتملة"});
 const r=db.prepare(`INSERT INTO products(name_ar,name_en,category,price,compare_price,stock,description_ar,description_en,image)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(p.name_ar,p.name_en,p.category,Number(p.price),Number(p.compare_price||0),Number(p.stock||0),p.description_ar||"",p.description_en||"",p.image||"");
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(r.lastInsertRowid));
});
app.put("/api/products/:id",(req,res)=>{
 const p=req.body;
 db.prepare(`UPDATE products SET name_ar=?,name_en=?,category=?,price=?,compare_price=?,stock=?,description_ar=?,description_en=?,image=? WHERE id=?`)
 .run(p.name_ar,p.name_en,p.category,Number(p.price),Number(p.compare_price||0),Number(p.stock||0),p.description_ar||"",p.description_en||"",p.image||"",req.params.id);
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id));
});
app.delete("/api/products/:id",(req,res)=>{
 db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id); res.json({ok:true});
});
app.get("/api/orders",(req,res)=>res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC").all()));
app.post("/api/orders",(req,res)=>{
 const {customer_name,phone,city,notes,items,total}=req.body;
 if(!customer_name||!phone||!Array.isArray(items)||!items.length) return res.status(400).json({error:"البيانات ناقصة"});
 const orderNo="ZM-"+Date.now().toString().slice(-9);
 const r=db.prepare(`INSERT INTO orders(order_no,customer_name,phone,city,notes,items_json,total) VALUES(?,?,?,?,?,?,?)`)
 .run(orderNo,customer_name,phone,city||"",notes||"",JSON.stringify(items),Number(total||0));
 res.json({id:r.lastInsertRowid,order_no:orderNo});
});
app.patch("/api/orders/:id",(req,res)=>{
 const allowed=["NEW","CONFIRMED","PROCESSING","READY","SHIPPED","DELIVERED","CANCELLED"];
 if(!allowed.includes(req.body.status)) return res.status(400).json({error:"حالة غير صالحة"});
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);
 res.json({ok:true});
});
app.get("/api/stats",(req,res)=>{
 const revenue=db.prepare("SELECT COALESCE(SUM(total),0) total FROM orders WHERE status!='CANCELLED'").get().total;
 const orders=db.prepare("SELECT COUNT(*) c FROM orders").get().c;
 const customers=db.prepare("SELECT COUNT(DISTINCT phone) c FROM orders").get().c;
 const products=db.prepare("SELECT COUNT(*) c FROM products WHERE active=1").get().c;
 const low=db.prepare("SELECT COUNT(*) c FROM products WHERE active=1 AND stock<=3").get().c;
 res.json({revenue,orders,customers,products,low});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`ZOMURUD running on http://localhost:${PORT}`));
