import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import pg from "pg";
import bcrypt from "bcryptjs";
import session from "express-session";

const PORT=process.env.PORT||3000;
const API_KEY=process.env.TWELVE_DATA_API_KEY;
const SYMBOLS=["EUR/USD","GBP/USD","USD/JPY","USD/BRL"];
const app=express();
app.disable("x-powered-by");
app.use(express.json());
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes("railway")?{rejectUnauthorized:false}:undefined});
await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`);
app.use(session({secret:process.env.SESSION_SECRET||"forex-na-pratica-session",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*24*30}}));
app.post("/api/register",async(req,res)=>{try{const name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");if(name.length<2||!email.includes("@")||password.length<6)return res.status(400).json({error:"Preencha nome, e-mail e senha com pelo menos 6 caracteres."});const hash=await bcrypt.hash(password,12);const q=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,hash]);req.session.user=q.rows[0];res.json({user:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Este e-mail já está cadastrado."});console.error(e);res.status(500).json({error:"Erro ao criar conta."})}});
app.post("/api/login",async(req,res)=>{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const q=await pool.query("SELECT * FROM users WHERE email=$1",[email]);const user=q.rows[0];if(!user||!await bcrypt.compare(password,user.password_hash))return res.status(401).json({error:"E-mail ou senha inválidos."});req.session.user={id:user.id,name:user.name,email:user.email};res.json({user:req.session.user})});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null}));
app.use(express.static("public"));
app.get("/health",(_req,res)=>res.json({ok:true,marketConfigured:Boolean(API_KEY)}));
const server=http.createServer(app);
const io=new Server(server);
const latest=new Map();
const status=(text,color="#9de8c5")=>io.emit("market-status",{text,color});

async function updateMarket(){
  if(!API_KEY){ status("● AGUARDANDO CONFIGURAÇÃO DA API","#ffb36b"); return; }
  try{
    const url="https://api.twelvedata.com/price?symbol="+encodeURIComponent(SYMBOLS.join(","))+"&apikey="+encodeURIComponent(API_KEY);
    const response=await fetch(url,{headers:{"User-Agent":"FOREX-NA-PRATICA/1.0"}});
    if(!response.ok) throw new Error("HTTP "+response.status);
    const data=await response.json();
    let count=0;
    for(const symbol of SYMBOLS){
      const item=data[symbol] ?? (SYMBOLS.length===1 ? data : null);
      const price=Number(item?.price);
      if(Number.isFinite(price)){
        const payload={symbol,price,timestamp:Date.now()};
        latest.set(symbol,payload);
        io.emit("forex-price",payload);
        count++;
      }
    }
    if(count) status("● COTAÇÕES AO VIVO");
    else {
      console.error("Twelve Data:",JSON.stringify(data));
      status("● DADOS TEMPORARIAMENTE INDISPONÍVEIS","#ff7474");
    }
  }catch(err){
    console.error("Twelve Data REST:",err.message);
    status("● RECONECTANDO COTAÇÕES...","#ffb36b");
  }
}
io.on("connection",socket=>{
  for(const value of latest.values()) socket.emit("forex-price",value);
  socket.emit("market-status",API_KEY?{text:"● CARREGANDO COTAÇÕES...",color:"#9de8c5"}:{text:"● AGUARDANDO CONFIGURAÇÃO DA API",color:"#ffb36b"});
});
updateMarket();
setInterval(updateMarket,300000);
server.listen(PORT,()=>console.log("FOREX NA PRÁTICA rodando na porta "+PORT));
