import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ====================================== 🚀 CẤU HÌNH & HẰNG SỐ ======================================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

const PORT = process.env.PORT || 3000;
// URL API mới
const API_HISTORY_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions";
const POLLING_INTERVAL = 3000; 

// 📊 BIẾN TOÀN CỤC
let rikResults = []; 
let rikIntervalCmd = null;

const predictionStats = {
    totalCorrect: 0, totalIncorrect: 0, lastPrediction: null, lastPredictedSession: 0,
};

// ====================================== ⚙️ UTILITIES CHUẨN ======================================
const lastN = (arr, n) => arr.slice(Math.max(0, arr.length - n));
// Chuyển kết quả sang chữ thường
const toLowerCaseResult = (result) => result ? (result === "Tài" || result === "T" ? "tài" : "xỉu") : 'xỉu';

// Hàm tìm kết quả có trọng số cao nhất (Ensemble Voting)
const majority = (obj) => {
    let maxK = null, maxV = -Infinity;
    for (const k in obj) {
        if (obj[k] > maxV) { maxV = obj[k]; maxK = k; }
    }
    // Logic chống kẹt cầu: Nếu trọng số chênh lệch quá thấp (<0.05), random để phá cầu
    if (Math.abs((obj['T']||0) - (obj['X']||0)) < 0.05) {
        return { key: Math.random() > 0.5 ? 'T' : 'X', val: maxV }; 
    }
    return { key: maxK, val: maxV };
};

// ====================================== 🧠 AI ALGORITHMS (HỌC TOÀN DIỆN CẦU) ======================================

// 1. Algo: Pattern Matching (Soi cầu quá khứ)
const algo_PatternMatch = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 20) return null;
    const last5 = tx.slice(-5).join('');
    const prevHistory = tx.slice(0, -1).join('');
    const foundIndex = prevHistory.lastIndexOf(last5);
    
    if (foundIndex !== -1 && foundIndex + 5 < tx.length) {
        return tx[foundIndex + 5]; 
    }
    return null;
}

// 2. Algo: Smart Trend Follow (AI Theo Cầu Thông Minh)
const algo_SmartFollow = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 8) return null;
    const last = tx.at(-1);

    // 2a. Cầu Bệt (Streak) - 4 đến 7 tay
    let run = 1;
    for(let i = tx.length - 2; i >= 0; i--) { if(tx[i] === last) run++; else break; }
    if (run >= 4 && run <= 7) return last; 

    // 2b. Cầu 1-1 (Alternating) - 4 tay trở lên
    if (tx.slice(-4).join('') === 'TXTX' || tx.slice(-4).join('') === 'XTXT') {
        return last === 'T' ? 'X' : 'T'; 
    }

    // 2c. Cầu 2-2 - 4 đến 6 tay
    if (tx.length >= 6) {
        const last6 = tx.slice(-6).join('');
        if (last6 === 'TTXXTT' || last6 === 'XXTTXX') return last === 'T' ? 'X' : 'T'; 
        if (last6.slice(-4) === 'TTXX' || last6.slice(-4) === 'XXTT') return last === 'T' ? 'X' : 'T';
    }
    
    return null;
}

// 3. Algo: Smart Trend Break (AI Bẻ Cầu Thông Minh)
const algo_SmartBreak = (history) => {
    const tx = history.map(h => h.tx);
    const last = tx.at(-1);
    let run = 1;
    for(let i = tx.length - 2; i >= 0; i--) { if(tx[i] === last) run++; else break; }

    // 3a. Bẻ Cầu Bệt Quá Dài (>8 tay)
    if (run >= 8) return last === 'T' ? 'X' : 'T'; 

    // 3b. Bẻ Cầu 1-1 Gãy (tạo bệt 2)
    if (run === 2 && tx.length >= 5) {
        if (tx.at(-3) !== last && tx.at(-4) === tx.at(-2) && tx.at(-5) !== tx.at(-3)) {
             return last === 'T' ? 'X' : 'T'; 
        }
    }
    
    // 3c. Bẻ Cầu 2-2 Gãy tạo thành bệt 3
    if (run === 3 && tx.length >= 6) {
        const last6 = tx.slice(-6).join(''); 
        if (last6.slice(0, 4) === 'TTXX' || last6.slice(0, 4) === 'XXTT') {
            return last === 'T' ? 'X' : 'T';
        }
    }

    return null;
}

// 4. Algo: Cycle Analysis (Phân tích chu kỳ 3)
const algo_Cycle3 = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 6) return null;
    if (tx.slice(-6, -3).join('') === tx.slice(-3).join('')) return tx.at(-3);
    return null;
}

// 5. Algo: Frequency Balance (Cân bằng tần suất)
const algo_FreqBalance = (history) => {
    const recent = lastN(history, 20).map(h => h.tx);
    const countT = recent.filter(x => x === 'T').length;
    if (countT >= 13) return 'X';
    if (countT <= 7) return 'T';
    return null;
}

// 6. Algo: Reverse Pattern (Mẫu đảo ngược)
const algo_ReversePattern = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 6) return null;
    const pattern1 = tx.slice(-6, -3); 
    const pattern2 = tx.slice(-3);     
    
    const isReverse = (pattern1[0] !== pattern2[2]) && 
                      (pattern1[1] !== pattern2[1]) && 
                      (pattern1[2] !== pattern2[0]);

    if (isReverse) {
        return pattern1[0] === 'T' ? 'X' : 'T'; 
    }
    return null;
}

// 7. Algo: Last 4 Mirror (Mẫu đối xứng 4)
const algo_Last4Mirror = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 4) return null;
    const last4 = tx.slice(-4);
    if (last4[0] === last4[3] && last4[1] === last4[2] && last4[0] !== last4[1]) {
        return last4[3] === 'T' ? 'X' : 'T'; 
    }
    return null;
}

// 8. Algo: Analysis Max VIP (Phân tích chuyên sâu & Phát hiện cầu thông minh)
const algo_AnalysisMaxVIP = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 10) return null;

    // 8a. Phát hiện Cầu 2-1-2-1-2 (9 sessions)
    const last9 = tx.slice(-9).join('');
    if (last9 === 'TTXTTXTTX') return 'T'; 
    if (last9 === 'XXTXXTXXT') return 'X'; 

    // 8b. Cầu Lặp 4 
    if (tx.length >= 8) {
        const pattern1 = tx.slice(-8, -4).join('');
        const pattern2 = tx.slice(-4).join('');
        if (pattern1 === pattern2) {
            return tx.at(-4); 
        }
    }

    // 8c. Cầu Ziczac dài (10 sessions)
    const last10 = tx.slice(-10).join('');
    if (last10 === 'TXTTXXTTXT') return tx.at(-9) === 'T' ? 'X' : 'T';
    
    return null;
}


const ALL_ALGS = [
    { id: 'algo_AnalysisMaxVIP', fn: algo_AnalysisMaxVIP },
    { id: 'algo_SmartFollow', fn: algo_SmartFollow },
    { id: 'algo_SmartBreak', fn: algo_SmartBreak },
    { id: 'algo_PatternMatch', fn: algo_PatternMatch },
    { id: 'algo_Cycle3', fn: algo_Cycle3 },
    { id: 'algo_FreqBalance', fn: algo_FreqBalance },
    { id: 'algo_ReversePattern', fn: algo_ReversePattern }, 
    { id: 'algo_Last4Mirror', fn: algo_Last4Mirror }      
];

// ====================================== 🧠 QUẢN LÝ TRỌNG SỐ (LEARNING SYSTEM) ======================================

class SEIUEnsemble {
    constructor(algorithms) {
        this.algs = algorithms;
        this.weights = {};
        for (const a of algorithms) this.weights[a.id] = 15.0; 
    }
    
    update(historyPrefix, actualTx) {
        for (const a of this.algs) {
            const pred = a.fn(historyPrefix);
            if (!pred) {
                this.weights[a.id] *= 0.99; 
                continue;
            }
            const correct = pred === actualTx;
            
            // THƯỞNG/PHẠT MẠNH MẼ để AI học nhanh và ổn định
            if (correct) {
                this.weights[a.id] *= 1.4; // Tăng 40%
            } else {
                this.weights[a.id] *= 0.55; // Giảm 45%
            }
            
            this.weights[a.id] = Math.max(0.5, Math.min(this.weights[a.id], 100)); // Giới hạn trọng số
        }
    }

    predictTX(history) {
        const votes = {};
        let totalW = 0;
        for (const a of this.algs) {
            const pred = a.fn(history);
            if (pred) {
                votes[pred] = (votes[pred] || 0) + this.weights[a.id];
                totalW += this.weights[a.id];
            }
        }
        
        if (!votes['T'] && !votes['X']) {
            return { prediction: Math.random() > 0.5 ? 'T' : 'X', confidence: 0.5 };
        }
        
        const { key: best, val: bestVal } = majority(votes);
        return { prediction: best === 'T' ? 'Tài' : 'Xỉu', confidence: bestVal / totalW };
    }
}

class SEIUManager {
    constructor() {
        this.history = [];
        this.ensemble = new SEIUEnsemble(ALL_ALGS);
        this.warm = false;
        this.currentTX = null;
    }

    loadInitial(lines) {
        this.history = lines.sort((a, b) => a.session - b.session); 
        this.warm = true;
        this.updatePrediction();
    }

    pushRecord(record) {
        if (predictionStats.lastPrediction && predictionStats.lastPredictedSession === record.session) {
            const actualTx = record.tx;
            if (predictionStats.lastPrediction === actualTx) predictionStats.totalCorrect++; 
            else predictionStats.totalIncorrect++;
        }

        const prefix = this.history.slice();
        if (prefix.length >= 5) this.ensemble.update(prefix, record.tx);

        this.history.push(record);
        if (this.history.length > 200) this.history.shift();
        
        this.updatePrediction();
        
        predictionStats.lastPrediction = this.currentTX.prediction === 'Tài' ? 'T' : 'X';
        predictionStats.lastPredictedSession = this.currentTX.session;
    }
    
    updatePrediction() {
        const txPred = this.ensemble.predictTX(this.history);
        this.currentTX = { ...txPred, session: (this.history.at(-1)?.session || 0) + 1 };
    }
}

const seiuManager = new SEIUManager();

// ====================================== 🌐 LOGIC POLLING (DATA CHUẨN 100%) ======================================

async function fetchAndProcessHistory() {
    try {
        const response = await fetch(API_HISTORY_URL, { timeout: 10000 });
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const json = await response.json();
        let rawRecords = json?.list || []; 
        
        const newHistory = rawRecords.map(item => {
            if (!item.point || !item.id || !item.dices) return null;
            
            return {
                session: item.id,
                dice: item.dices,
                total: item.point,
                result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
                tx: item.resultTruyenThong === 'TAI' ? 'T' : 'X'
            };
        }).filter(r => r !== null); 

        if (newHistory.length === 0) return;

        const currentLastSession = seiuManager.history.at(-1)?.session || 0;
        
        if (!seiuManager.warm) {
             console.log(`✅ AI Đã học ${newHistory.length} phiên lịch sử.`);
             seiuManager.loadInitial(newHistory);
             rikResults = seiuManager.history.slice().reverse().slice(0, 60); 
        } else {
            const sortedNew = newHistory.sort((a, b) => a.session - b.session);
            
            for (const record of sortedNew) { 
                if (record.session > currentLastSession) {
                    seiuManager.pushRecord(record);
                    rikResults.unshift(record); 
                    if (rikResults.length > 60) rikResults.pop();
                    console.log(`🔔 Cập nhật phiên #${record.session}: ${record.total} (${record.result})`);
                }
            }
        }

    } catch (e) {
        console.error("❌ Lỗi Polling:", e.message);
    }
}

fetchAndProcessHistory();
if (rikIntervalCmd) clearInterval(rikIntervalCmd);
rikIntervalCmd = setInterval(fetchAndProcessHistory, POLLING_INTERVAL); 


// ====================================== 🖥️ ENDPOINT API MỚI ======================================
app.get("/api/taixiumd5/lc79", async () => { 
  
  const total = predictionStats.totalCorrect + predictionStats.totalIncorrect;
  
  const lastSession = rikResults.length > 0 ? rikResults[0] : null;
  const historyPattern = rikResults.map(item => item.result === 'Tài' ? 't' : 'x').slice(0, 50).join('');
      
  if (!lastSession || !seiuManager.warm) {
    return {
        "id": "GiazThinhz AI Analysis Thông Minh", // ĐÃ CẬP NHẬT
        "trang_thai": "Đang tải dữ liệu...",
        "Panter": historyPattern
    };
  }
  
  const predTX = seiuManager.currentTX;

  return {
    "id": "GiazThinhz AI Analysis Thông Minh", // ĐÃ CẬP NHẬT
    "phien_truoc": lastSession.session,
    "xuc_xac1": lastSession.dice[0],
    "xuc_xac2": lastSession.dice[1],
    "xuc_xac3": lastSession.dice[2],
    "tong": lastSession.total,
    "ket_qua": toLowerCaseResult(lastSession.result),
    
    "phien_hien_ai": predTX.session,
    
    // DỰ ĐOÁN T/X (Chữ thường)
    "du_doan": toLowerCaseResult(predTX.prediction), 
    "ty_le_thanh_cong_du_doan": `${(predTX.confidence * 100).toFixed(0)}%`,
    
    "Panter": historyPattern,
    
    "thong_ke_hieu_suat_he_thong": {
      "tong_so_lan_du_doan": total,
      "tong_lan_thang": predictionStats.totalCorrect,
      "tong_lan_thua": predictionStats.totalIncorrect,
      "ty_le_thang": total > 0 ? `${((predictionStats.totalCorrect/total)*100).toFixed(2)}%` : "0%"
    }
  };
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Server AI đang chạy tại: http://0.0.0.0:${PORT}/api/taixiumd5/lc79`);
  } catch (err) {
    console.error(err);
    process.exit(1); 
  }
};
start();
