import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";

const PORT=process.env.PORT||3000;
const API_KEY=process.env.TWELVE_DATA_API_KEY;
const SYMBOLS=["EUR/USD","GBP/USD","USD/JPY","USD/BRL"];
const app=express();
app.disable("x-powered-by");
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
