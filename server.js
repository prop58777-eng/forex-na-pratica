import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import WebSocket from "ws";

const PORT=process.env.PORT||3000;
const API_KEY=process.env.TWELVE_DATA_API_KEY;
const SYMBOLS=["EUR/USD","GBP/USD","USD/JPY","USD/BRL"];
const app=express();
app.disable("x-powered-by");
app.use(express.static("public"));
app.get("/health",(_req,res)=>res.json({ok:true,marketConfigured:Boolean(API_KEY)}));
const server=http.createServer(app);
const io=new Server(server);
let marketSocket,heartbeat,reconnectTimer;
const latest=new Map();
const status=(text,color="#9de8c5")=>io.emit("market-status",{text,color});

function connectMarket(){
  if(!API_KEY){ console.warn("TWELVE_DATA_API_KEY não configurada."); status("● AGUARDANDO CONFIGURAÇÃO DA API","#ffb36b"); return; }
  clearInterval(heartbeat); clearTimeout(reconnectTimer);
  marketSocket=new WebSocket("wss://ws.twelvedata.com/v1/quotes/price?apikey="+encodeURIComponent(API_KEY));
  marketSocket.on("open",()=>{
    marketSocket.send(JSON.stringify({action:"subscribe",params:{symbols:SYMBOLS.join(",")}}));
    heartbeat=setInterval(()=>{if(marketSocket?.readyState===WebSocket.OPEN)marketSocket.send(JSON.stringify({action:"heartbeat"}));},10000);
    status("● CONECTADO AO MERCADO");
  });
  marketSocket.on("message",raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.event==="price"&&msg.symbol&&msg.price!=null){
        const payload={symbol:msg.symbol,price:Number(msg.price),timestamp:msg.timestamp||Date.now()};
        latest.set(msg.symbol,payload); io.emit("forex-price",payload);
      }
      if(msg.status==="error"||msg.event==="error") status("● DADOS TEMPORARIAMENTE INDISPONÍVEIS","#ff7474");
    }catch{}
  });
  marketSocket.on("close",()=>{clearInterval(heartbeat);status("● RECONECTANDO...","#ffb36b");reconnectTimer=setTimeout(connectMarket,5000);});
  marketSocket.on("error",err=>console.error("WebSocket:",err.message));
}
io.on("connection",socket=>{for(const value of latest.values())socket.emit("forex-price",value);if(!API_KEY)socket.emit("market-status",{text:"● AGUARDANDO CONFIGURAÇÃO DA API",color:"#ffb36b"});});
connectMarket();
server.listen(PORT,()=>console.log("FOREX NA PRÁTICA rodando na porta "+PORT));
