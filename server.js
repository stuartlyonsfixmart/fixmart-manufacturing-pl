'use strict';
const express=require('express'),session=require('express-session'),path=require('path'),{BigQuery}=require('@google-cloud/bigquery'),NodeCache=require('node-cache');
const app=express(),bq=new BigQuery({projectId:'project-aa7ee149-5e29-4eb4-8bc'}),cache=new NodeCache({stdTTL:600});
const PORT=process.env.PORT||8080,USERS={pete:'pete'};

app.set('trust proxy',1);
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret:process.env.SESSION_SECRET||'fixmart-mfg-pl-2026',
  resave:true,
  saveUninitialized:false,
  cookie:{maxAge:8*60*60*1000,secure:false,sameSite:'lax'}
}));
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){
  if(req.session&&req.session.user)return next();
  if(req.path.startsWith('/api/'))return res.status(401).json({success:false,error:'Not authenticated'});
  res.redirect('/login.html');
}

app.post('/login',(req,res)=>{
  const{username,password}=req.body;
  if(USERS[username]===password){
    req.session.user=username;
    req.session.save(err=>{
      if(err)console.error('Session save error:',err);
      res.redirect('/');
    });
  } else {
    res.redirect('/login.html?error=1');
  }
});

app.get('/logout',(req,res)=>{req.session.destroy();res.redirect('/login.html');});

const DS='`project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.vw_manufacturing_pl`';

app.get('/api/summary',auth,async(req,res)=>{
  const{startDate,endDate}=req.query;
  if(!startDate||!endDate)return res.status(400).json({success:false,error:'missing dates'});
  const k=`s_${startDate}_${endDate}`,c=cache.get(k);
  if(c)return res.json({success:true,data:c,fromCache:true});
  try{
    const[rows]=await bq.query({query:`SELECT period_date,ROUND(SUM(CASE WHEN section='Revenue' THEN net_amount ELSE 0 END),2) AS revenue,ROUND(SUM(CASE WHEN section='Cost' THEN net_amount ELSE 0 END),2) AS costs,ROUND(SUM(net_amount),2) AS net_result FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate GROUP BY 1 ORDER BY 1`,params:{startDate,endDate},location:'europe-west2'});
    const data=rows.map(r=>({period_date:r.period_date?r.period_date.value||String(r.period_date):'',revenue:r.revenue,costs:r.costs,net_result:r.net_result}));
    cache.set(k,data);res.json({success:true,data,fromCache:false});
  }catch(err){console.error(err);res.status(500).json({success:false,error:err.message});}
});

app.get('/api/lines',auth,async(req,res)=>{
  const{startDate,endDate}=req.query;
  if(!startDate||!endDate)return res.status(400).json({success:false,error:'missing dates'});
  const k=`l_${startDate}_${endDate}`,c=cache.get(k);
  if(c)return res.json({success:true,data:c,fromCache:true});
  try{
    const[rows]=await bq.query({query:`SELECT period_date,section,line_label,ROUND(SUM(net_amount),2) AS total FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate GROUP BY 1,2,3 ORDER BY 1,2,3`,params:{startDate,endDate},location:'europe-west2'});
    const data=rows.map(r=>({period_date:r.period_date?r.period_date.value||String(r.period_date):'',section:r.section,line_label:r.line_label,total:r.total}));
    cache.set(k,data);res.json({success:true,data,fromCache:false});
  }catch(err){console.error(err);res.status(500).json({success:false,error:err.message});}
});

app.get('/api/detail',auth,async(req,res)=>{
  const{startDate,endDate,lineLabel}=req.query;
  if(!startDate||!endDate||!lineLabel)return res.status(400).json({success:false,error:'missing params'});
  const k=`d_${startDate}_${endDate}_${lineLabel}`,c=cache.get(k);
  if(c)return res.json({success:true,data:c,fromCache:true});
  try{
    const[rows]=await bq.query({query:`SELECT transaction_date,reference,description,nominal,source,ROUND(net_amount,2) AS net_amount FROM ${DS} WHERE period_date BETWEEN @startDate AND @endDate AND line_label=@lineLabel ORDER BY transaction_date DESC,net_amount`,params:{startDate,endDate,lineLabel},location:'europe-west2'});
    const data=rows.map(r=>({transaction_date:r.transaction_date?r.transaction_date.value||String(r.transaction_date):'',reference:r.reference||'',description:r.description||'',nominal:r.nominal,source:r.source,net_amount:r.net_amount}));
    cache.set(k,data);res.json({success:true,data,fromCache:false});
  }catch(err){console.error(err);res.status(500).json({success:false,error:err.message});}
});

app.get('/',auth,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('*',(req,res)=>res.redirect('/login.html'));
app.listen(PORT,()=>console.log(`Manufacturing P&L running on ${PORT}`));
