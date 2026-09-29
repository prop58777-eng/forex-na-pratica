import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import pg from "pg";
import bcrypt from "bcryptjs";
import session from "express-session";
import crypto from "crypto";

const PORT=process.env.PORT||3000;
const API_KEY=process.env.TWELVE_DATA_API_KEY;
const SYMBOLS=["EUR/USD","GBP/USD","USD/JPY","USD/BRL"];
const app=express();
app.disable("x-powered-by");
app.use(express.json());
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes("railway")?{rejectUnauthorized:false}:undefined});
await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,reset_token_hash TEXT,reset_token_expires TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`);
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT");
await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ");
app.use(session({secret:process.env.SESSION_SECRET||"forex-na-pratica-session",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*24*30}}));
app.post("/api/register",async(req,res)=>{try{const name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");if(name.length<2||!email.includes("@")||password.length<6)return res.status(400).json({error:"Preencha nome, e-mail e senha com pelo menos 6 caracteres."});const hash=await bcrypt.hash(password,12);const q=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,hash]);req.session.user=q.rows[0];res.json({user:q.rows[0]})}catch(e){if(e.code==="23505")return res.status(409).json({error:"Este e-mail já está cadastrado."});console.error(e);res.status(500).json({error:"Erro ao criar conta."})}});
app.post("/api/login",async(req,res)=>{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const q=await pool.query("SELECT * FROM users WHERE email=$1",[email]);const user=q.rows[0];if(!user||!await bcrypt.compare(password,user.password_hash))return res.status(401).json({error:"E-mail ou senha inválidos."});req.session.user={id:user.id,name:user.name,email:user.email};res.json({user:req.session.user})});
app.post("/api/forgot-password",async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase();const q=await pool.query("SELECT id FROM users WHERE email=$1",[email]);if(q.rows[0]){const token=crypto.randomBytes(32).toString("hex"),hash=crypto.createHash("sha256").update(token).digest("hex");await pool.query("UPDATE users SET reset_token_hash=$1,reset_token_expires=NOW()+INTERVAL '30 minutes' WHERE id=$2",[hash,q.rows[0].id]);const link="https://www.forexnapratica.api.br/?reset="+token;const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"FOREX NA PRÁTICA <contato@forexnapratica.api.br>",to:[email],subject:"Redefinição de senha - FOREX NA PRÁTICA",html:'<h2>Redefinição de senha</h2><p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="'+link+'">Clique aqui para criar uma nova senha</a></p><p>Este link expira em 30 minutos.</p><p>Se você não solicitou isso, ignore este e-mail.</p>'})});if(!rr.ok)console.error("Resend:",rr.status,await rr.text())}res.json({message:"Se o e-mail estiver cadastrado, enviaremos um link de recuperação."})}catch(e){console.error(e);res.status(500).json({error:"Não foi possível enviar o e-mail de recuperação."})}});
app.post("/api/reset-password",async(req,res)=>{try{const token=String(req.body.token||""),password=String(req.body.password||"");if(token.length<20||password.length<6)return res.status(400).json({error:"Link inválido ou senha muito curta."});const hash=crypto.createHash("sha256").update(token).digest("hex"),passHash=await bcrypt.hash(password,12);const q=await pool.query("UPDATE users SET password_hash=$1,reset_token_hash=NULL,reset_token_expires=NULL WHERE reset_token_hash=$2 AND reset_token_expires>NOW() RETURNING id,name,email",[passHash,hash]);if(!q.rows[0])return res.status(400).json({error:"Este link é inválido ou expirou. Solicite outro."});req.session.user=q.rows[0];res.json({user:q.rows[0],message:"Senha redefinida com sucesso."})}catch(e){console.error(e);res.status(500).json({error:"Erro ao redefinir senha."})}});
app.post("/api/support-ai",async(req,res)=>{try{if(!req.session.user)return res.status(401).json({error:"Entre na sua conta para usar o Suporte IA."});if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"Suporte IA aguardando ativação da chave da OpenAI."});const message=String(req.body.message||"").trim();const history=Array.isArray(req.body.history)?req.body.history.slice(-8):[];if(message.length<2||message.length>1500)return res.status(400).json({error:"Digite uma mensagem entre 2 e 1500 caracteres."});const input=[{role:"developer",content:"Você é o Suporte IA 24h do site FOREX NA PRÁTICA. Responda em português do Brasil, de forma clara, curta e prestativa. Ajude com cadastro, login, recuperação de senha, navegação e educação geral sobre Forex. O site é educacional. Não prometa lucros, não diga que uma operação terá resultado garantido, não execute operações e não dê sinais personalizados de compra ou venda. Em dúvidas sobre investimento, explique conceitos e riscos de forma educacional. Nunca peça senha, token, chave de API ou dados bancários."},...history.filter(x=>x&&["user","assistant"].includes(x.role)&&typeof x.content==="string").map(x=>({role:x.role,content:x.content.slice(0,1500)})),{role:"user",content:message}];const rr=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-luna",input,max_output_tokens:500})});const data=await rr.json();if(!rr.ok){console.error("OpenAI:",rr.status,JSON.stringify(data));return res.status(502).json({error:"O Suporte IA está temporariamente indisponível."})}const answer=(data.output||[]).flatMap(o=>o.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n").trim();if(!answer)return res.status(502).json({error:"Não foi possível gerar uma resposta agora."});res.json({answer})}catch(e){console.error(e);res.status(500).json({error:"Erro no Suporte IA."})}});
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
