import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ====================================== 🚀 cấu hình ======================================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

const port = process.env.port || 3000;
const api_history_url = "https://wtxmd52.tele68.com/v1/txmd5/sessions";
const polling_interval = 3000; 

// 📊 biến toàn cục
let rik_results = []; 
let rik_interval_cmd = null;

const prediction_stats = {
    total_correct: 0, total_incorrect: 0, last_prediction: null, last_predicted_session: 0,
};

// ====================================== ⚙️ utilities ======================================

const to_lower_case_result = (result) => result ? (result === "Tài" || result === "T" ? "tài" : "xỉu") : 'xỉu';

// hàm tìm kết quả có trọng số cao nhất (ensemble voting)
const majority = (obj) => {
    let max_k = null, max_v = -Infinity;
    for (const k in obj) {
        if (obj[k] > max_v) { max_v = obj[k]; max_k = k; }
    }
    // chống kẹt cầu: random khi trọng số gần bằng nhau
    if (Math.abs((obj['T']||0) - (obj['X']||0)) < 0.05) {
        return { key: Math.random() > 0.5 ? 'T' : 'X', val: max_v }; 
    }
    return { key: max_k, val: max_v };
};

// ====================================== 🧠 full ai analysis algorithms ======================================

// 1. algo: pattern matching (soi cầu quá khứ)
const algo_patternmatch = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 5) return null;
    const prev_history = tx.slice(0, -1).join('');
    for(let n = 5; n >= 3; n--) {
        const last_n_pattern = tx.slice(-n).join('');
        const found_index = prev_history.lastIndexOf(last_n_pattern);
        if (found_index !== -1 && found_index + n < tx.length) return tx[found_index + n]; 
    }
    return null;
}

// 2. algo: smart trend follow (cầu bệt/1-1)
const algo_smartfollow = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 8) return null;
    const last = tx.at(-1);
    let run = 1;
    for(let i = tx.length - 2; i >= 0; i--) { if(tx[i] === last) run++; else break; }
    if (run >= 4 && run <= 7) return last; 
    const last6 = tx.slice(-6).join('');
    if (last6 === 'TXTXTX' || last6 === 'XTXTXT') { return last === 'T' ? 'X' : 'T'; }
    return null;
}

// 3. algo: smart trend break (bẻ cầu)
const algo_smartbreak = (history) => {
    const tx = history.map(h => h.tx);
    const last = tx.at(-1);
    let run = 1;
    for(let i = tx.length - 2; i >= 0; i--) { if(tx[i] === last) run++; else break; }
    if (run >= 8 && run < 10) return last === 'T' ? 'X' : 'T'; 
    return null;
}

// 4. algo: total score analysis (thuật toán tổng xúc xắc)
const algo_totalscore = (history) => {
    if (history.length < 2) return null;
    const last_record = history.at(-1);
    const prev_record = history.at(-2);
    const total_diff = last_record.total - prev_record.total;
    if (total_diff > 5) return 'X'; 
    if (total_diff < -5) return 'T';
    if (Math.abs(total_diff) <= 1) return last_record.tx;
    return null;
}

// 5. algo: bias breaker (phá cầu dài & cân bằng tần suất)
const algo_biasbreaker = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 5) return null;
    const last = tx.at(-1);
    let run = 1;
    for(let i = tx.length - 2; i >= 0; i--) { if(tx[i] === last) run++; else break; }
    if (run >= 10) return last === 'T' ? 'X' : 'T'; 
    const recent5 = tx.slice(-5);
    const count_t = recent5.filter(x => x === 'T').length;
    if (count_t >= 4) return 'X'; 
    if (count_t <= 1) return 'T'; 
    return null;
}

// 6. algo: cycle analysis (phân tích chu kỳ 3)
const algo_cycle3 = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 6) return null;
    if (tx.slice(-6, -3).join('') === tx.slice(-3).join('')) return tx.at(-3);
    return null;
}

// 7. algo: frequency balance (cân bằng tần suất dài 20 phiên)
const algo_freqbalance = (history) => {
    const recent = history.slice(Math.max(0, history.length - 20)).map(h => h.tx);
    const count_t = recent.filter(x => x === 'T').length;
    if (count_t >= 13) return 'X'; 
    if (count_t <= 7) return 'T';  
    return null;
}

// 8. algo: analysis max vip (cầu 2-1-2-1-2 và cầu lặp 4)
const algo_analysismaxvip = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 9) return null;
    const last9 = tx.slice(-9).join('');
    if (last9 === 'TTXTTXTTX') return 'T'; 
    if (last9 === 'XXTXXTXXT') return 'X'; 
    if (tx.length >= 8) {
        const pattern1 = tx.slice(-8, -4).join('');
        const pattern2 = tx.slice(-4).join('');
        if (pattern1 === pattern2) { return tx.at(-4); }
    }
    return null;
}

// 9. algo: deep pattern stability (phân tích chuỗi dài 12 tay)
const algo_longcyclesequence = (history) => {
    const tx = history.map(h => h.tx);
    if (tx.length < 12) return null;
    const pattern1 = tx.slice(-12, -6).join(''); 
    const pattern2 = tx.slice(-6).join('');
    if (pattern1 === pattern2) { return tx.at(-6); }
    return null;
}


const all_algs = [
    { id: 'algo_totalscore', fn: algo_totalscore, weight: 20.0 },
    { id: 'algo_patternmatch', fn: algo_patternmatch, weight: 15.0 },
    { id: 'algo_smartfollow', fn: algo_smartfollow, weight: 15.0 },
    { id: 'algo_smartbreak', fn: algo_smartbreak, weight: 10.0 },
    { id: 'algo_biasbreaker', fn: algo_biasbreaker, weight: 25.0 },
    { id: 'algo_cycle3', fn: algo_cycle3, weight: 10.0 },
    { id: 'algo_freqbalance', fn: algo_freqbalance, weight: 12.0 },
    { id: 'algo_analysismaxvip', fn: algo_analysismaxvip, weight: 18.0 },
    { id: 'algo_longcyclesequence', fn: algo_longcyclesequence, weight: 10.0 }
];

// ====================================== 🧠 ai trọng số (ensemble) - fixed confidence ======================================

class seiu_ensemble {
    constructor(algorithms) {
        this.algs = algorithms;
        this.weights = {};
        for (const a of algorithms) this.weights[a.id] = a.weight; 
    }
    
    update(history_prefix, actual_tx) {
        for (const a of this.algs) {
            const pred = a.fn(history_prefix);
            if (!pred) {
                // decay cực kỳ nhẹ cho thuật toán không dự đoán
                this.weights[a.id] = Math.max(1.0, this.weights[a.id] * 0.9999); 
                continue;
            }
            const correct = pred === actual_tx;
            
            // FIX TRIỆT ĐỂ: Thay đổi trọng số siêu chậm (Hệ số 0.1%)
            if (correct) { this.weights[a.id] *= 1.001; } // Thưởng CỰC KỲ NHẸ
            else { this.weights[a.id] *= 0.999; } // Phạt CỰC KỲ NHẸ
            
            this.weights[a.id] = Math.max(1.0, Math.min(this.weights[a.id], 150.0)); 
        }
    }

    predict_tx(history) {
        const votes = {};
        let total_w = 0;
        
        for (const a of this.algs) {
            const pred = a.fn(history);
            if (pred) {
                // ngưỡng hoạt động của thuật toán
                if (this.weights[a.id] > 5.0) { 
                    votes[pred] = (votes[pred] || 0) + this.weights[a.id];
                    total_w += this.weights[a.id];
                }
            }
        }
        
        if (total_w === 0) {
            return { prediction: Math.random() > 0.5 ? 'T' : 'X', confidence: 0.5 };
        }
        
        const { key: best, val: best_val } = majority(votes);
        
        // giới hạn độ tin cậy tối đa ở 95% (độ tin cậy thật)
        const raw_confidence = best_val / total_w;
        const confidence = Math.min(raw_confidence, 0.95); 

        return { prediction: best === 'T' ? 'Tài' : 'Xỉu', confidence };
    }
}

class seiu_manager {
    constructor() {
        this.history = [];
        this.ensemble = new seiu_ensemble(all_algs);
        this.warm = false;
        this.current_tx = null;
    }

    load_initial(lines) {
        this.history = lines.sort((a, b) => a.session - b.session); 
        for(let i = 3; i < this.history.length; i++) {
            this.ensemble.update(this.history.slice(0, i), this.history[i].tx);
        }
        this.warm = true;
        this.update_prediction();
    }

    push_record(record) {
        if (prediction_stats.last_prediction && prediction_stats.last_predicted_session === record.session) {
            const actual_tx = record.tx;
            if (prediction_stats.last_prediction === actual_tx) prediction_stats.total_correct++; 
            else prediction_stats.total_incorrect++;
        }

        const prefix = this.history.slice();
        if (prefix.length >= 3) this.ensemble.update(prefix, record.tx); 
        
        this.history.push(record);
        if (this.history.length > 200) this.history.shift();
        
        this.update_prediction();
        
        prediction_stats.last_prediction = this.current_tx.prediction === 'Tài' ? 'T' : 'X';
        prediction_stats.last_predicted_session = this.current_tx.session;
    }
    
    update_prediction() {
        const tx_pred = this.ensemble.predict_tx(this.history);
        this.current_tx = { ...tx_pred, session: (this.history.at(-1)?.session || 0) + 1 };
    }
}

const seiu_manager_instance = new seiu_manager();

// ====================================== 🌐 logic polling ======================================

async function fetch_and_process_history() {
    try {
        const response = await fetch(api_history_url, { timeout: 10000 });
        if (!response.ok) throw new Error(`http error: ${response.status}`);
        
        const json = await response.json();
        let raw_records = json?.list || []; 
        
        const new_history = raw_records.map(item => {
            if (!item.point || !item.id || !item.dices) return null;
            
            let dices_string = item.dices;
            if (typeof dices_string !== 'string') { dices_string = String(dices_string); }
            
            const dices = dices_string.split(',').map(Number);
            
            return {
                session: item.id,
                dice: dices,
                total: item.point,
                result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
                tx: item.resultTruyenThong === 'TAI' ? 'T' : 'X'
            };
        }).filter(r => r !== null); 

        if (new_history.length === 0) return;

        const current_last_session = seiu_manager_instance.history.at(-1)?.session || 0;
        
        if (!seiu_manager_instance.warm) {
             console.log(`✅ ai đã học ${new_history.length} phiên lịch sử.`);
             seiu_manager_instance.load_initial(new_history);
             rik_results = seiu_manager_instance.history.slice().reverse().slice(0, 60); 
        } else {
            const sorted_new = new_history.sort((a, b) => a.session - b.session);
            
            for (const record of sorted_new) { 
                if (record.session > current_last_session) {
                    seiu_manager_instance.push_record(record);
                    rik_results.unshift(record); 
                    if (rik_results.length > 60) rik_results.pop();
                    console.log(`🔔 cập nhật phiên #${record.session}: ${record.total} (${record.result})`);
                }
            }
        }

    } catch (e) {
        console.error("❌ lỗi polling:", e.message);
    }
}

fetch_and_process_history();
if (rik_interval_cmd) clearInterval(rik_interval_cmd);
rik_interval_cmd = setInterval(fetch_and_process_history, polling_interval); 


// ====================================== 🖥️ endpoint api cuối cùng ======================================
app.get("/api/taixiumd5/lc79", async () => { 
  
  const total = prediction_stats.total_correct + prediction_stats.total_incorrect;
  const last_session = rik_results.length > 0 ? rik_results[0] : null;
  const history_pattern = rik_results.map(item => item.result === 'Tài' ? 't' : 'x').slice(0, 50).join('');
      
  const id_string = "GiazThinhhz👾";

  if (!last_session || !seiu_manager_instance.warm) {
    return {
        "id": id_string, 
        "trang_thai": "đang tải dữ liệu...",
        "panter": history_pattern
    };
  }
  
  const pred_tx = seiu_manager_instance.current_tx;
  const confidence_percent = (pred_tx.confidence * 100).toFixed(2);
  
  // trả về json đã làm gọn
  return {
    "id": id_string, 
    "phien_truoc": last_session.session,
    "xuc_xac1": last_session.dice[0],
    "xuc_xac2": last_session.dice[1],
    "xuc_xac3": last_session.dice[2],
    "tong": last_session.total,
    "ket_qua": to_lower_case_result(last_session.result),
    
    "phien_hien_ai": pred_tx.session,
    
    "du_doan": to_lower_case_result(pred_tx.prediction), 
    "do_tin_cay": `${confidence_percent}%`, // độ tin cậy thực tế (tối đa 95%)
    
    "panter": history_pattern,
    
    "thong_ke_hieu_suat_he_thong": {
      "tong_so_lan_du_doan": total,
      "tong_lan_thang": prediction_stats.total_correct,
      "tong_lan_thua": prediction_stats.total_incorrect,
      "ty_le_thang_tong_the": total > 0 ? `${((prediction_stats.total_correct/total)*100).toFixed(2)}%` : "0.00%"
    }
  };
});

const start = async () => {
  try {
    await app.listen({ port: port, host: "0.0.0.0" });
    console.log(`server ai đang chạy tại: http://0.0.0.0:${port}/api/taixiumd5/lc79`);
  } catch (err) {
    console.error(err);
    process.exit(1); 
  }
};
start();
