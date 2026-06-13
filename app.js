// ===== Firebase 설정 =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, collection,
  getDocs, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyCnZHPPBuCzdCZETpx5uB4q83tZYh6Ar_s",
  authDomain: "onion-sales-2b466.firebaseapp.com",
  projectId: "onion-sales-2b466",
  storageBucket: "onion-sales-2b466.firebasestorage.app",
  messagingSenderId: "125063724082",
  appId: "1:125063724082:web:71632fa0cd417c495a902b"
};

const fbApp  = initializeApp(firebaseConfig);
const db     = getFirestore(fbApp);
const auth   = getAuth(fbApp);
const gProvider = new GoogleAuthProvider();

// ===== 컬러 팔레트 =====
const COLORS = [
  {dot:'#639922',bg:'#EAF3DE',tc:'#27500A',ch:'#639922'},
  {dot:'#378ADD',bg:'#E6F1FB',tc:'#0C447C',ch:'#378ADD'},
  {dot:'#BA7517',bg:'#FAEEDA',tc:'#633806',ch:'#BA7517'},
  {dot:'#D4537E',bg:'#FBEAF0',tc:'#72243E',ch:'#D4537E'},
  {dot:'#1D9E75',bg:'#E1F5EE',tc:'#085041',ch:'#1D9E75'},
  {dot:'#7F77DD',bg:'#EEEDFE',tc:'#3C3489',ch:'#7F77DD'},
  {dot:'#888780',bg:'#F1EFE8',tc:'#444441',ch:'#888780'},
  {dot:'#E24B4A',bg:'#FCEBEB',tc:'#791F1F',ch:'#E24B4A'},
];

// ===== 앱 데이터 =====
let items    = [];
let partners = [];
let orders   = {};
let prices   = {};
let memos    = {};

// ===== UI 상태 =====
const state = {};
let activeItem      = 0;
let isDirty         = false;
let autoLogoutTimer = null;
let autoLogoutMins  = 0; // 0 = 비활성
const undoStack   = [];  // 되돌리기 스택 (최대 20회)
const UNDO_LIMIT  = 20;
let qOrder        = [];
let todayP        = {};
let mChart        = null;
let debounceTimer = null;
let nextItemId    = 1;
let currentUser   = null;

// ===== 유틸 =====
const today   = () => new Date().toISOString().slice(0,10);
const msStart = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt     = n  => Number(n).toLocaleString('ko-KR');
const fmtS    = n  => { if(n>=1e8)return(n/1e8).toFixed(1).replace(/\.0$/,'')+'억'; if(n>=1e4)return Math.round(n/1e4)+'만'; return fmt(n); };
const colorOf = id => { const i=items.findIndex(x=>x.id===id)%COLORS.length; return i>=0?COLORS[i]:COLORS[0]; };
const activeItems = () => items.filter(x => x.active !== false);
const getP    = id => todayP[id] || 0;
const lineP   = (pi,li) => { const s=state[pi]?.[li]; if(!s||!s.itemId)return 0; return s.customPrice!==null?s.customPrice:getP(s.itemId); };
const lineDisc= (pi,li) => { const s=state[pi]?.[li]; if(!s||!s.itemId||s.customPrice===null)return false; return s.customPrice!==getP(s.itemId); };
const prevMonth = () => {
  const d=new Date(),y=d.getFullYear(),m=d.getMonth();
  const pm=m===0?11:m-1, py=m===0?y-1:y;
  const last=new Date(py,pm+1,0).getDate();
  return { from:`${py}-${String(pm+1).padStart(2,'0')}-01`, to:`${py}-${String(pm+1).padStart(2,'0')}-${String(last).padStart(2,'0')}` };
};

// ===== 동기화 상태 =====
function setSyncStatus(status, msg) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-txt');
  if (!dot||!txt) return;
  dot.className = 'sync-dot ' + status;
  txt.textContent = msg;
}

// ===== 로그인 UI =====
function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
}
function showAppScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
}

window.loginWithGoogle = async function() {
  try {
    document.getElementById('login-btn').textContent = '로그인 중...';
    await signInWithPopup(auth, gProvider);
  } catch(e) {
    document.getElementById('login-btn').textContent = '구글로 로그인';
    if (e.code !== 'auth/popup-closed-by-user') {
      alert('로그인 오류: ' + e.message);
    }
  }
};


// ===== 자동 로그아웃 =====
function startAutoLogout(mins) {
  if (autoLogoutTimer) clearInterval(autoLogoutTimer);
  autoLogoutMins = mins;
  if (mins <= 0) { autoLogoutTimer = null; return; }
  // 로그인 시각 저장
  if (!localStorage.getItem('onion_login_time')) {
    localStorage.setItem('onion_login_time', Date.now().toString());
  }
  // 1분마다 경과 시간 체크 (백그라운드 복귀 시에도 작동)
  autoLogoutTimer = setInterval(async () => {
    const loginTime = parseInt(localStorage.getItem('onion_login_time') || '0');
    const elapsed = (Date.now() - loginTime) / (1000 * 60); // 분
    if (elapsed >= mins) {
      clearInterval(autoLogoutTimer);
      localStorage.removeItem('onion_login_time');
      alert(`자동 로그아웃: ${mins}분이 경과했습니다.`);
      await signOut(auth);
    }
  }, 60 * 1000); // 1분마다 체크
}
window.setAutoLogout = function(mins) {
  autoLogoutMins = parseInt(mins) || 0;
  localStorage.setItem('onion_auto_logout', autoLogoutMins);
  // 새 설정 시 로그인 시각 리셋
  if (autoLogoutMins > 0) {
    localStorage.setItem('onion_login_time', Date.now().toString());
  } else {
    localStorage.removeItem('onion_login_time');
  }
  startAutoLogout(autoLogoutMins);
  const lbl = document.getElementById('auto-logout-lbl');
  if (lbl) lbl.textContent = autoLogoutMins > 0 ? `${autoLogoutMins}분 후 자동 로그아웃` : '자동 로그아웃 꺼짐';
};

window.logout = async function() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  await signOut(auth);
};

// ===== Firebase 읽기 =====
async function loadFromCloud() {
  try {
    setSyncStatus('ing', '클라우드에서 로딩 중...');

    const [itemsDoc, partnersDoc, ordersSnap, pricesSnap, memosSnap] = await Promise.all([
      getDoc(doc(db, 'config', 'items')),
      getDoc(doc(db, 'config', 'partners')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'prices')),
      getDocs(collection(db, 'memos')),
    ]);

    if (itemsDoc.exists())    { items    = itemsDoc.data().list    || []; nextItemId = Math.max(...items.map(x=>x.id),0)+1; }
    if (partnersDoc.exists()) { partners = partnersDoc.data().list || []; }

    orders = {}; ordersSnap.forEach(d => { orders[d.id] = d.data().rows || []; });
    prices = {}; pricesSnap.forEach(d => { prices[d.id] = d.data().map  || {}; });
    memos  = {}; memosSnap.forEach(d  => { memos[d.id]  = d.data().content || ''; });

    setSyncStatus('ok', '클라우드 연결됨');
    updateLastSyncTime();
  } catch(e) {
    setSyncStatus('err', '연결 오류');
    console.error('Cloud load error:', e);
  }
}

function updateLastSyncTime() {
  const el = document.getElementById('last-sync-txt');
  if (el) el.textContent = '마지막 동기화: ' + new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
}

// ===== Firebase 쓰기 (디바운스 1.5초) =====
function scheduleSync(fn) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    setSyncStatus('ing', '저장 중...');
    try {
      await fn();
      setSyncStatus('ok', '저장 완료 ✓');
      updateLastSyncTime();
    } catch(e) {
      setSyncStatus('err', '저장 실패');
      console.error('Cloud save error:', e);
    }
  }, 1500);
}

const saveItems    = () => setDoc(doc(db,'config','items'),   {list:items});
const savePartners = () => setDoc(doc(db,'config','partners'),{list:partners});
const saveOrders_c = (date,rows) => rows.length>0
  ? setDoc(doc(db,'orders',date),  {rows,updatedAt:new Date().toISOString()})
  : deleteDoc(doc(db,'orders',date));
const savePrices_c = (date,map)  => Object.keys(map).length>0
  ? setDoc(doc(db,'prices',date),  {map,updatedAt:new Date().toISOString()})
  : Promise.resolve();
const saveMemo_c   = (date,text) => text
  ? setDoc(doc(db,'memos',date),   {content:text,updatedAt:new Date().toISOString()})
  : deleteDoc(doc(db,'memos',date));

// ===== 앱 초기화 =====
async function initApp(user) {
  currentUser = user;

  // 기본 데이터
  if (items.length === 0) {
    items = [
      {id:1,name:'12키로 6줄',active:true},{id:2,name:'12키로 7줄',active:true},
      {id:3,name:'12키로 짱아지',active:true},{id:4,name:'15키로 특대',active:true},
      {id:5,name:'15키로 특',active:true},{id:6,name:'15키로 상',active:true},
      {id:7,name:'15키로 중',active:true},
    ];
  }
  if (partners.length === 0) {
    partners = [
      '7000','1482','6427','7777','8888','0595','6694','9199','1399','5309',
      '0801','8000','7854','3198','8262','7441','2947','5076','0265','5633',
      '3124','1073','2262','3335','2331','2783','6418','4994','4501','4061',
      '1334','0768','6587','6007'
    ];
  }

  await loadFromCloud();

  nextItemId = Math.max(...items.map(x=>x.id),0) + 1;
  partners.forEach((_,i) => { state[i] = [{itemId:0,customPrice:null,qty:0}]; });

  const d = today();
  document.getElementById('order-date').value = d;
  document.getElementById('sf').value  = msStart();
  document.getElementById('st').value  = d;
  document.getElementById('sef').value = msStart();
  document.getElementById('set').value = d;

  // 자동 로그아웃 설정 복원
  const savedLogout = parseInt(localStorage.getItem('onion_auto_logout')) || 0;
  if (savedLogout > 0) startAutoLogout(savedLogout);
  const alEl = document.getElementById('auto-logout-sel');
  if (alEl) alEl.value = savedLogout;
  const lbl = document.getElementById('auto-logout-lbl');
  if (lbl) lbl.textContent = savedLogout > 0 ? `${savedLogout}분 후 자동 로그아웃` : '자동 로그아웃 꺼짐';

  // 폰트 크기 복원
  tableFontScale = parseInt(localStorage.getItem('onion_font_scale')) || 100;
  applyFontScale();

  // 사용자 이름 표시
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = user.displayName || user.email;

  loadDay(d);
  fillSettleSel();
  fillDiscPartnerSel();
  renderItemSettings();
  renderPartnerSettings();

  document.getElementById('order-date').addEventListener('change', function() {
    if (isDirty && !confirm('저장되지 않은 주문이 있습니다.\n날짜를 변경할까요?')) {
      this.value = today(); return;
    }
    loadDay(this.value);
  });

  // 앱 숨김/종료 시 자동저장
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isDirty) saveOrder();
  });
  // 페이지 언로드 시 동기 저장 시도
  window.addEventListener('pagehide', () => { if(isDirty) saveOrder(); });

  document.getElementById('loading').style.display = 'none';
  showAppScreen();
}

function loadDay(date) {
  todayP = Object.assign({}, prices[date] || {});

  // state 초기화
  partners.forEach((_,i) => { state[i] = [{itemId:0,customPrice:null,qty:0}]; });

  // ★ Firebase에서 불러온 오늘 주문 데이터를 state에 복원
  const savedRows = orders[date] || [];
  if (savedRows.length > 0) {
    savedRows.forEach(row => {
      const pi = partners.indexOf(row.partner);
      if (pi < 0) return;
      // 해당 거래처의 첫 번째 빈 슬롯 또는 새 슬롯에 추가
      const emptyIdx = state[pi].findIndex(s => !s.itemId);
      const entry = {
        itemId: row.itemId,
        customPrice: row.discount ? row.price : null,
        qty: row.qty
      };
      if (emptyIdx >= 0) {
        state[pi][emptyIdx] = entry;
      } else {
        state[pi].push(entry);
      }
    });
  }

  renderPriceGrid();
  renderItemTabs();
  renderTable();
  loadMemo(date);
  document.getElementById('psaved').style.display = prices[date] ? 'inline' : 'none';
  isDirty = false;
}

// ===== 인증 상태 감지 (앱 진입점) =====
window.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, user => {
    if (user) {
      // 앱 열 때 즉시 자동 로그아웃 시간 체크
      const savedMins = parseInt(localStorage.getItem('onion_auto_logout')) || 0;
      const loginTime = parseInt(localStorage.getItem('onion_login_time') || '0');
      if (savedMins > 0 && loginTime > 0) {
        const elapsed = (Date.now() - loginTime) / (1000 * 60);
        if (elapsed >= savedMins) {
          localStorage.removeItem('onion_login_time');
          signOut(auth);
          return;
        }
      }
      showAppScreen();
      initApp(user);
    } else {
      document.getElementById('loading').style.display = 'none';
      showLoginScreen();
    }
  });

  window.addEventListener('beforeunload', () => { if(isDirty) saveOrder(); });
});

// ===== 탭 전환 =====
window.switchPane = function(name, btn) {
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nbtn').forEach(b => b.classList.remove('on'));
  document.getElementById('pane-' + name).classList.add('on');
  btn.classList.add('on');
  document.getElementById('fab').style.display = name === 'order' ? 'flex' : 'none';
  if (name === 'settings') { renderItemSettings(); renderPartnerSettings(); }
  // 검색 탭 진입 시 이전 결과 초기화
  if (name === 'memo') {
    clearMemoSearch();
    clearDiscSearch();
  }
};

// ===== 단가 그리드 =====
function renderPriceGrid() {
  const grid = document.getElementById('pgrid');
  grid.innerHTML = '';
  activeItems().forEach(it => {
    const c = colorOf(it.id);
    const p = todayP[it.id] || '';
    const div = document.createElement('div');
    div.className = 'pitem';
    div.innerHTML = `
      <label class="plabel" style="background:${c.bg};color:${c.tc};">
        <span class="ds" style="background:${c.dot};flex-shrink:0;"></span>
        <span class="pn">${it.name}</span>
      </label>
      <input class="pinput" type="number" data-id="${it.id}" value="${p}"
        placeholder="단가 입력" min="0" step="100" inputmode="numeric"
        oninput="onPriceIn(this)" onblur="saveTodayP()">`;
    grid.appendChild(div);
  });
}

window.onPriceIn = function(inp) {
  const id  = parseInt(inp.dataset.id);
  const val = parseInt(inp.value) || 0;
  if (val > 0) todayP[id] = val; else delete todayP[id];
  partners.forEach((_,pi) => {
    (state[pi]||[]).forEach((s,li) => {
      if (s.itemId !== id || s.customPrice !== null) return;
      const p2 = getP(id), amt = s.qty > 0 ? s.qty * p2 : 0;
      const pe = document.querySelector(`.pricinp[data-pi="${pi}"][data-li="${li}"]`);
      const ae = document.getElementById(`ac-${pi}-${li}`);
      if (pe) pe.value = p2 || '';
      if (ae) { ae.textContent = amt > 0 ? fmt(amt) : '—'; ae.style.color = amt > 0 ? 'var(--t1)' : 'var(--t3)'; }
    });
  });
  updateSummary();
};

window.saveTodayP = function() {
  const date = document.getElementById('order-date').value;
  if (!Object.keys(todayP).length) return;
  prices[date] = Object.assign({}, prices[date]||{}, todayP);
  document.getElementById('psaved').style.display = 'inline';
  scheduleSync(() => savePrices_c(date, prices[date]));
};

// ===== 품목 탭 =====
function renderItemTabs() {
  const wrap = document.getElementById('itabs');
  wrap.innerHTML = '';
  const all = document.createElement('span');
  all.className = 'itab' + (activeItem === 0 ? ' on' : '');
  all.style.color = 'var(--t2)';
  all.textContent = '전체';
  all.onclick = () => { activeItem = 0; renderItemTabs(); };
  wrap.appendChild(all);
  activeItems().forEach(it => {
    const c = colorOf(it.id);
    const btn = document.createElement('span');
    btn.className = 'itab' + (activeItem === it.id ? ' on' : '');
    btn.style.color = c.tc;
    if (activeItem === it.id) btn.style.background = c.bg;
    btn.innerHTML = `<span class="ds" style="background:${c.dot};display:inline-block;margin-right:3px;"></span>${it.name}`;
    btn.onclick = () => { activeItem = it.id; renderItemTabs(); };
    wrap.appendChild(btn);
  });
}


// ===== 되돌리기 =====
function saveUndoSnapshot() {
  const snapshot = partners.map((_,pi) =>
    (state[pi]||[]).map(s => ({...s}))
  );
  undoStack.push(JSON.stringify(snapshot));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoBtn();
}
function updateUndoBtn() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = undoStack.length === 0;
  btn.style.opacity = undoStack.length === 0 ? '0.4' : '1';
  btn.title = `되돌리기 (${undoStack.length}회 가능)`;
  btn.textContent = undoStack.length > 0 ? `↩${undoStack.length}` : '↩';
}
window.undoAction = function() {
  if (!undoStack.length) return;
  const snapshot = JSON.parse(undoStack.pop());
  snapshot.forEach((lines, pi) => { state[pi] = lines; });
  isDirty = true;
  renderTable();
  updateUndoBtn();
};

// ===== 주문 테이블 =====
function makeBadge(it) {
  const c = colorOf(it.id);
  const inactiveMark = it.active===false ? ' <span style="font-size:9px;opacity:0.6;">(종료)</span>' : '';
  return `<span class="ibadge" style="background:${c.bg};color:${c.tc};"><span class="ds" style="background:${c.dot};"></span>${it.name}${inactiveMark}</span>`;
}

function renderTable() {
  const tb = document.getElementById('tbody');
  tb.innerHTML = ''; qOrder = [];
  partners.forEach((name, pi) => {
    if (!state[pi]||!state[pi].length) state[pi]=[{itemId:0,customPrice:null,qty:0}];
    const lines=state[pi]; const tl=lines.length;
    lines.forEach((s,li) => {
      const it   = s.itemId ? items.find(x=>x.id===s.itemId) : null;
      const c    = it ? colorOf(it.id) : null;
      const p    = lineP(pi,li);
      const disc = lineDisc(pi,li);
      const amt  = it && s.qty > 0 ? s.qty * p : 0;
      const isM  = li===0; const isL=li===tl-1;
      const tr   = document.createElement('tr');
      if      (isM&&tl===1) tr.className='solo';
      else if (isM)          tr.className='mrow';
      else if (isL)          tr.className='lsub srow';
      else                   tr.className='srow';
      if (disc) tr.style.background='#FCEBEB22';
      else if (it&&c) tr.style.background=c.bg+'33';

      const itemCell = isM
        ? (it ? makeBadge(it) : `<span style="color:var(--t3);font-size:10px;">-</span>`)
        : `<select class="sssel" data-pi="${pi}" data-li="${li}" onchange="onSubSel(this)">
             <option value="0">선택</option>
             ${activeItems().map(x=>`<option value="${x.id}" ${x.id===s.itemId?'selected':''}>${x.name}</option>`).join('')}
             ${items.filter(x=>x.active===false&&x.id===s.itemId).map(x=>`<option value="${x.id}" selected>${x.name} (종료)</option>`).join('')}
           </select>`;

      tr.innerHTML = `
        <td style="font-family:monospace;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${isM?name:''}</td>
        <td style="overflow:hidden;">${itemCell}</td>
        <td class="r">
          ${disc?'<span class="dtag">할인</span>':''}
          <input class="pricinp" type="number" data-pi="${pi}" data-li="${li}"
            value="${s.itemId&&p?p:''}" placeholder="-" ${!s.itemId?'disabled':''}
            onchange="onPriceChange(this)" min="0" step="100" inputmode="numeric" style="font-size:10px;">
        </td>
        <td class="r"><input class="qinp" type="number" data-pi="${pi}" data-li="${li}"
          value="${s.qty>0?s.qty:''}" placeholder="0" min="0" inputmode="numeric"
          oninput="onQty(this)" onblur="fixQty(this)" onkeydown="onQtyKey(event,this)" style="font-size:11px;"></td>
        <td class="r acell" id="ac-${pi}-${li}"
          style="color:${amt>0?'var(--t1)':'var(--t3)'};">${amt>0?fmt(amt):'—'}</td>
        <td style="text-align:center;vertical-align:middle;white-space:nowrap;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            ${isL?`<button class="abtn" onclick="addLine(${pi})" title="품목 추가">＋</button>`:'<span style="width:18px;"></span>'}
            ${li>0?`<button class="dbtn" onclick="delLine(${pi},${li})" title="이 행 삭제">✕</button>`:''}
          </div>
        </td>`;
      tb.appendChild(tr);
      if (isM) qOrder.push({pi});
    });
  });
  updateSummary();
  updateProgress();
}

window.onQtyKey = function(e, inp) {
  if (e.key !== 'Enter') return;
  e.preventDefault(); fixQty(inp);
  const pi  = parseInt(inp.dataset.pi);
  const idx = qOrder.findIndex(o=>o.pi===pi);
  if (idx>=0&&idx<qOrder.length-1) {
    const nxt = document.querySelector(`.qinp[data-pi="${qOrder[idx+1].pi}"][data-li="0"]`);
    if (nxt) { nxt.focus(); nxt.select(); }
  }
};

window.onQty = function(inp) {
  const pi=parseInt(inp.dataset.pi), li=parseInt(inp.dataset.li), qty=parseInt(inp.value)||0;
  if (!state[pi]) state[pi]=[{itemId:0,customPrice:null,qty:0}];
  const s = state[pi][li];
  if (li===0&&qty>0&&!s.itemId) {
    s.itemId = activeItem || activeItems()[0]?.id || 1; s.customPrice = null;
    const it=items.find(x=>x.id===s.itemId), c=it?colorOf(it.id):null;
    const tr=inp.closest('tr');
    tr.querySelectorAll('td')[1].innerHTML = it ? makeBadge(it) : '';
    const pe=tr.querySelector('.pricinp'), p2=getP(s.itemId);
    if (pe) {
      pe.value=p2||''; pe.disabled=false;
      pe.parentNode.querySelectorAll('.dtag').forEach(t=>t.remove()); // 할인태그 제거
    }
    tr.style.background = c ? c.bg+'33' : '';
  }
  if (li===0&&qty===0&&s.itemId) {
    s.itemId=0; s.customPrice=null;
    const tr=inp.closest('tr');
    tr.querySelectorAll('td')[1].innerHTML=`<span style="color:var(--t3);font-size:10px;">-</span>`;
    const pe=tr.querySelector('.pricinp');
    if (pe) {
      pe.value=''; pe.disabled=true;
      pe.parentNode.querySelectorAll('.dtag').forEach(t=>t.remove()); // 할인태그 제거
    }
    tr.style.background='';
  }
  s.qty=qty; isDirty=true;
  const p2=lineP(pi,li), amt=qty>0&&s.itemId?qty*p2:0;
  const ae=document.getElementById(`ac-${pi}-${li}`);
  if (ae) { ae.textContent=amt>0?fmt(amt):'—'; ae.style.color=amt>0?'var(--t1)':'var(--t3)'; }
  updateSummary(); updateProgress();
};

window.fixQty = function(inp) { const v=parseInt(inp.value)||0; inp.value=v>0?v:''; };

window.onSubSel = function(sel) {
  const pi=parseInt(sel.dataset.pi), li=parseInt(sel.dataset.li);
  state[pi][li].itemId=parseInt(sel.value)||0; state[pi][li].customPrice=null;
  isDirty=true; renderTable();
  if (state[pi][li].itemId) setTimeout(()=>{
    const q=document.querySelector(`.qinp[data-pi="${pi}"][data-li="${li}"]`);
    if (q){q.focus();q.select();}
  },30);
};

window.onPriceChange = function(inp) {
  const pi=parseInt(inp.dataset.pi), li=parseInt(inp.dataset.li), val=parseInt(inp.value)||0;
  if (!state[pi]) return;
  const s=state[pi][li];
  s.customPrice=val===getP(s.itemId)?null:val;
  const p=lineP(pi,li), amt=s.qty>0?s.qty*p:0;
  const ae=document.getElementById(`ac-${pi}-${li}`);
  if (ae){ae.textContent=amt>0?fmt(amt):'—';ae.style.color=amt>0?'var(--t1)':'var(--t3)';}
  const tr=inp.closest('tr'), disc=lineDisc(pi,li);
  const it=items.find(x=>x.id===s.itemId), c=it?colorOf(it.id):null;
  if (disc) tr.style.background='#FCEBEB22';
  else tr.style.background=c?c.bg+'33':'';
  // 할인 태그 - 기존 전부 제거 후 필요시 새로 추가
  inp.parentNode.querySelectorAll('.dtag').forEach(t=>t.remove());
  if(disc){const b=document.createElement('span');b.className='dtag';b.textContent='할인';inp.parentNode.insertBefore(b,inp);}
  isDirty=true; updateSummary();
};

window.addLine = pi => { saveUndoSnapshot(); state[pi].push({itemId:0,customPrice:null,qty:0}); renderTable(); };
window.delLine = (pi,li) => { saveUndoSnapshot(); state[pi].splice(li,1); if(!state[pi].length)state[pi]=[{itemId:0,customPrice:null,qty:0}]; renderTable(); };

function updateSummary() {
  let total=0,qty=0,cnt=0;
  partners.forEach((_,pi) => {
    let has=false;
    (state[pi]||[]).forEach((_s,li) => {
      const it=_s.itemId?items.find(x=>x.id===_s.itemId):null;
      if(it&&_s.qty>0){total+=_s.qty*lineP(pi,li);qty+=_s.qty;has=true;}
    }); if(has)cnt++;
  });
  document.getElementById('s-total').textContent=fmtS(total)||'0';
  document.getElementById('s-qty').textContent=fmt(qty)||'0';
  document.getElementById('s-cnt').textContent=cnt;
  document.getElementById('ft-qty').textContent=qty>0?fmt(qty):'-';
  document.getElementById('ft-amt').textContent=total>0?fmt(total):'-';
}

function updateProgress() {
  const done=partners.filter((_,pi)=>state[pi]?.some(s=>s.itemId>0&&s.qty>0)).length;
  const total=partners.length, pct=total>0?Math.round(done/total*100):0;
  document.getElementById('pgtxt').textContent=`${done} / ${total}곳`;
  const fill=document.getElementById('pgfill');
  fill.style.width=pct+'%';
  fill.style.background=pct===100?'#16a34a':pct>=50?'#639922':'#d97706';
}

// ===== 저장 =====
window.saveOrder = function() {
  const date=document.getElementById('order-date').value; if(!date)return;
  const miss=activeItems().filter(it=>!todayP[it.id]);
  const used=new Set();
  partners.forEach((_,pi)=>(state[pi]||[]).forEach(s=>{if(s.itemId&&s.qty>0)used.add(s.itemId);}));
  const warn=miss.filter(it=>used.has(it.id));
  if (warn.length>0&&!confirm(`⚠ 단가 미입력:\n${warn.map(it=>it.name).join(', ')}\n\n0원으로 저장합니까?`)) return;
  const rows=[];
  partners.forEach((name,i)=>{
    (state[i]||[]).forEach((s,li)=>{
      const it=s.itemId?items.find(x=>x.id===s.itemId):null;
      if(it&&s.qty>0){const p=lineP(i,li);rows.push({partner:name,itemId:s.itemId,itemName:it.name,qty:s.qty,price:p,amt:s.qty*p,discount:s.customPrice!==null});}
    });
  });
  if(!rows.length){alert('저장할 데이터가 없습니다.');return;}
  orders[date]=rows; isDirty=false;
  saveTodayP();
  scheduleSync(() => saveOrders_c(date, rows));
};

window.manualSync = async function() {
  setSyncStatus('ing','동기화 중...');
  try {
    await loadFromCloud();
    loadDay(document.getElementById('order-date').value);
  } catch(e) { setSyncStatus('err','동기화 실패'); }
};

// ===== 메모 =====
function loadMemo(date) {
  const memo=memos[date]||'';
  const btn=document.getElementById('mtbtn'), body=document.getElementById('mbody'), chev=document.getElementById('mtchev');
  document.getElementById('mta').value=memo;
  if(memo){
    btn.className='mtoggle hm'; document.getElementById('mtlbl').textContent='📝 메모 ✓';
    body.classList.add('open'); chev.style.transform='rotate(90deg)';
  } else {
    btn.className='mtoggle'; document.getElementById('mtlbl').textContent='📝 메모';
    body.classList.remove('open'); chev.style.transform='';
  }
}
window.toggleMemo = function() {
  const b=document.getElementById('mbody'), c=document.getElementById('mtchev');
  const o=b.classList.toggle('open'); c.style.transform=o?'rotate(90deg)':'';
};
window.saveMemo = function() {
  const date=document.getElementById('order-date').value;
  const text=document.getElementById('mta').value.trim();
  memos[date]=text; loadMemo(date);
  scheduleSync(() => saveMemo_c(date, text));
};
window.deleteMemo = function() {
  const date=document.getElementById('order-date').value;
  delete memos[date]; loadMemo(date);
  scheduleSync(() => saveMemo_c(date,''));
};

// ===== 검색 탭 전환 =====
// ===== 검색 초기화 =====
window.clearMemoSearch = function() {
  document.getElementById('mkw').value = '';
  document.getElementById('mf').value  = '';
  document.getElementById('mt').value  = '';
  document.getElementById('memores').innerHTML = '<div class="nodata">검색어를 입력하고 검색하세요</div>';
};
window.clearDiscSearch = function() {
  document.getElementById('disc-partner').value = 'all';
  document.getElementById('df').value = '';
  document.getElementById('dt').value = '';
  document.getElementById('disc-result').innerHTML = '<div class="nodata">조건을 선택하고 조회하세요</div>';
};

window.switchSearchTab = function(tab) {
  document.getElementById('search-pane-memo').style.display = tab==='memo' ? '' : 'none';
  document.getElementById('search-pane-disc').style.display = tab==='disc' ? '' : 'none';
  document.getElementById('search-tab-memo').style.background = tab==='memo' ? 'var(--acc)' : 'var(--bg2)';
  document.getElementById('search-tab-memo').style.color = tab==='memo' ? '#fff' : 'var(--t2)';
  document.getElementById('search-tab-disc').style.background = tab==='disc' ? '#dc2626' : 'var(--bg2)';
  document.getElementById('search-tab-disc').style.color = tab==='disc' ? '#fff' : 'var(--t2)';
  if (tab==='disc') fillDiscPartnerSel();
};

function fillDiscPartnerSel() {
  const sel = document.getElementById('disc-partner');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="all">전체 거래처</option>';
  partners.forEach(p => { const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o); });
  if (cur) sel.value = cur;
}

// ===== 할인 내역 검색 =====
window.runDiscSearch = function() {
  const fp   = document.getElementById('disc-partner').value;
  const from = document.getElementById('df').value;
  const to   = document.getElementById('dt').value;
  const wrap = document.getElementById('disc-result');

  if (!from || !to) { wrap.innerHTML='<div class="nodata">기간을 선택해 주세요</div>'; return; }

  // 할인 거래 추출
  const discRows = [];
  Object.entries(orders).forEach(([date, rows]) => {
    if (date < from || date > to) return;
    rows.forEach(r => {
      if (!r.discount) return;
      if (fp !== 'all' && r.partner !== fp) return;
      discRows.push({ date, ...r });
    });
  });

  if (!discRows.length) {
    wrap.innerHTML = '<div class="nodata">해당 기간에 할인 내역이 없습니다</div>';
    return;
  }

  // 거래처별 그룹화
  const byPartner = {};
  discRows.forEach(r => {
    if (!byPartner[r.partner]) byPartner[r.partner] = {};
    const key = r.itemName;
    if (!byPartner[r.partner][key]) byPartner[r.partner][key] = [];
    byPartner[r.partner][key].push(r);
  });

  let html = '';
  let grandTotalLoss = 0;

  Object.entries(byPartner).sort().forEach(([pname, itemMap]) => {
    let partnerLoss = 0;
    let partnerHtml = '';

    Object.entries(itemMap).sort().forEach(([itemName, rows]) => {
      // 날짜 범위별로 연속 그룹 묶기
      rows.sort((a,b) => a.date > b.date ? 1 : -1);

      // 가격별 그룹화 (같은 할인가 연속 구간)
      const priceGroups = [];
      rows.forEach(r => {
        const last = priceGroups[priceGroups.length-1];
        // 해당 날짜의 정상 단가 찾기
        const normalPrice = prices[r.date]?.[r.itemId] || 0;
        const discountAmt = normalPrice > 0 ? normalPrice - r.price : 0;
        if (last && last.price === r.price && last.normalPrice === normalPrice) {
          last.qty += r.qty;
          last.endDate = r.date;
          last.rows.push(r);
        } else {
          priceGroups.push({ price:r.price, normalPrice, discountAmt, qty:r.qty, startDate:r.date, endDate:r.date, rows:[r] });
        }
      });

      priceGroups.forEach(g => {
        const totalQty  = g.qty;
        const lossAmt   = g.discountAmt > 0 ? g.discountAmt * totalQty : 0;
        partnerLoss    += lossAmt;
        const dateRange = g.startDate === g.endDate ? g.startDate : `${g.startDate.slice(5)} ~ ${g.endDate.slice(5)}`;
        const discStr   = g.normalPrice > 0 ? `${fmt(g.normalPrice)}원 → ${fmt(g.price)}원 (${fmt(g.discountAmt)}원 할인)` : `${fmt(g.price)}원 (정상가 미등록)`;
        partnerHtml += `
          <div style="padding:8px 13px;border-bottom:1px solid var(--bd);background:var(--bg);">
            <div style="font-size:11px;color:var(--t2);margin-bottom:3px;">📅 ${dateRange}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
              <span style="font-size:13px;font-weight:500;">${itemName}</span>
              <span style="font-size:12px;color:var(--red);">${discStr}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:3px;">
              <span style="font-size:12px;color:var(--t2);">총 ${fmt(totalQty)}박스</span>
              ${lossAmt>0 ? `<span style="font-size:12px;font-weight:500;color:var(--red);">손실 ${fmt(lossAmt)}원</span>` : '<span style="font-size:11px;color:var(--t3);">정상가 미등록</span>'}
            </div>
          </div>`;
      });
    });

    grandTotalLoss += partnerLoss;
    html += `
      <div style="margin:8px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;">
        <div style="padding:10px 13px;background:var(--red-l);border-bottom:1px solid var(--red-b);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:600;font-family:monospace;color:var(--red);">${pname}</span>
          ${partnerLoss>0 ? `<span style="font-size:13px;font-weight:600;color:var(--red);">총 손실 ${fmt(partnerLoss)}원</span>` : ''}
        </div>
        ${partnerHtml}
      </div>`;
  });

  // 전체 손실 합계
  const summary = `
    <div style="margin:8px 12px 0;padding:12px 14px;background:#fff3f3;border:1px solid var(--red-b);border-radius:var(--r);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:13px;font-weight:600;color:var(--red);">💸 전체 할인 손실 합계</span>
      <span style="font-size:16px;font-weight:700;color:var(--red);">${fmt(grandTotalLoss)}원</span>
    </div>
    <div style="margin:4px 12px 0;font-size:11px;color:var(--t3);padding:0 2px;">※ 정상 단가가 등록된 날짜만 손실 계산됩니다</div>`;

  wrap.innerHTML = summary + html + '<div style="height:24px;"></div>';
};

window.runMemoSearch = function() {
  const kw=document.getElementById('mkw').value.trim().toLowerCase();
  const from=document.getElementById('mf').value, to=document.getElementById('mt').value;
  const res=Object.entries(memos).filter(([d,t])=>{
    if(from&&d<from)return false; if(to&&d>to)return false;
    if(kw&&!t.toLowerCase().includes(kw))return false; return true;
  }).sort(([a],[b])=>b>a?1:-1);
  const wrap=document.getElementById('memores');
  if(!res.length){wrap.innerHTML='<div class="nodata">검색 결과가 없습니다</div>';return;}
  wrap.innerHTML=res.map(([date,text])=>{
    const hi=kw?text.replace(new RegExp(kw,'gi'),m=>`<mark style="background:#FDE68A;">${m}</mark>`):text;
    return `<div class="mrc"><div class="mrd">📅 ${date}</div><div class="mrt">${hi}</div></div>`;
  }).join('');
};

// ===== 통계 =====
window.runStat = function() {
  const from=document.getElementById('sf').value, to=document.getElementById('st').value;
  if(!from||!to)return;
  const data=[];
  Object.entries(orders).forEach(([date,rows])=>{if(date>=from&&date<=to)rows.forEach(r=>data.push({date,...r}));});
  const tA=data.reduce((a,r)=>a+r.amt,0), tQ=data.reduce((a,r)=>a+r.qty,0);
  document.getElementById('sc-total').textContent=tA>0?fmtS(tA)+'원':'-';
  document.getElementById('sc-qty').textContent=tQ>0?fmt(tQ)+'박스':'-';
  const pm=prevMonth();
  const prev=[];Object.entries(orders).forEach(([d,rows])=>{if(d>=pm.from&&d<=pm.to)rows.forEach(r=>prev.push(r));});
  const pA=prev.reduce((a,r)=>a+r.amt,0), pQ=prev.reduce((a,r)=>a+r.qty,0);
  const dh=(c,p)=>{if(!p||!c)return'';const d=Math.round((c-p)/p*100);if(d>0)return`<span class="dup">▲${d}% 전월</span>`;if(d<0)return`<span class="ddn">▼${Math.abs(d)}% 전월</span>`;return'';};
  document.getElementById('sc-total-d').innerHTML=dh(tA,pA);
  document.getElementById('sc-qty-d').innerHTML=dh(tQ,pQ);
  const am={};data.forEach(r=>{am[r.itemName]=(am[r.itemName]||0)+r.amt;});
  const rank=Object.entries(am).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(rank.length){
    document.getElementById('rsec').style.display='block';
    const mx=rank[0][1]||1;
    document.getElementById('rlist').innerHTML=rank.map(([nm,val],i)=>{
      const it=items.find(x=>x.name===nm);const c=it?colorOf(it.id):COLORS[0];
      return `<div class="ritem"><div class="rmed">${['🥇','🥈','🥉','4','5'][i]}</div>
        <div class="rinfo"><div class="rnm">${nm}</div>
          <div class="rbbg"><div class="rbfill" style="width:${Math.round(val/mx*100)}%;background:${c.ch};"></div></div>
        </div><div class="rvl">${fmtS(val)}원</div></div>`;
    }).join('');
  } else document.getElementById('rsec').style.display='none';

  // ★ 거래처별 매출 순위 TOP10
  const partnerAmt={};data.forEach(r=>{partnerAmt[r.partner]=(partnerAmt[r.partner]||0)+r.amt;});
  const partnerRank=Object.entries(partnerAmt).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const prsec=document.getElementById('partner-rsec');
  if(partnerRank.length&&prsec){
    prsec.style.display='block';
    const pmx=partnerRank[0][1]||1;
    document.getElementById('partner-rlist').innerHTML=partnerRank.map(([nm,val],i)=>{
      const medals=['🥇','🥈','🥉','4','5','6','7','8','9','10'];
      return `<div class="ritem"><div class="rmed" style="font-size:${i<3?'14px':'11px'};">${medals[i]}</div>
        <div class="rinfo"><div class="rnm">${nm}</div>
          <div class="rbbg"><div class="rbfill" style="width:${Math.round(val/pmx*100)}%;background:#378ADD;"></div></div>
        </div><div class="rvl">${fmtS(val)}원</div></div>`;
    }).join('');
  } else if(prsec) prsec.style.display='none';

  // ★ 기간별 매출 차트 (일별/주별/월별)
  const byDay={};const byDayQty={};
  data.forEach(r=>{const k=r.date.slice(5);byDay[k]=(byDay[k]||0)+r.amt;byDayQty[k]=(byDayQty[k]||0)+r.qty;});
  const labels=Object.keys(byDay).sort().slice(-30);
  const ctx=document.getElementById('mchart');if(mChart)mChart.destroy();
  mChart=new Chart(ctx,{type:'bar',
    data:{labels,datasets:[
      {label:'금액',data:labels.map(k=>byDay[k]||0),backgroundColor:'#378ADD88',borderColor:'#378ADD',borderWidth:1,yAxisID:'y'},
      {label:'수량',data:labels.map(k=>byDayQty[k]||0),type:'line',borderColor:'#639922',backgroundColor:'transparent',yAxisID:'y2',tension:.3,pointRadius:2}
    ]},
    options:{responsive:true,maintainAspectRatio:true,aspectRatio:2.2,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:10}},
        tooltip:{callbacks:{label:c=>c.dataset.label==='금액'?' 금액: '+fmt(c.parsed.y)+'원':' 수량: '+fmt(c.parsed.y)+'박스'}}},
      scales:{y:{position:'left',ticks:{callback:v=>fmtS(v),font:{size:9}},grid:{color:'rgba(0,0,0,0.04)'}},
        y2:{position:'right',ticks:{callback:v=>fmt(v),font:{size:9}},grid:{display:false}},
        x:{ticks:{font:{size:9},maxRotation:45},grid:{display:false}}}}});
  document.getElementById('ctit').textContent=`일별 판매금액 / 수량 (최근 ${labels.length}일)`;

  // ★ 품목별 도넛 차트
  const amtMap={},qtyMap={};data.forEach(r=>{amtMap[r.itemName]=(amtMap[r.itemName]||0)+r.amt;qtyMap[r.itemName]=(qtyMap[r.itemName]||0)+r.qty;});
  const iLabels=Object.keys(amtMap).sort();
  const bgC=iLabels.map(l=>{const it=items.find(x=>x.name===l);return it?colorOf(it.id).ch+'bb':'#88888866';});
  const bdC=iLabels.map(l=>{const it=items.find(x=>x.name===l);return it?colorOf(it.id).ch:'#888';});
  if(window._chartItemAmt)window._chartItemAmt.destroy();
  if(window._chartItemQty)window._chartItemQty.destroy();
  const donutEl1=document.getElementById('chart-item-amt');
  const donutEl2=document.getElementById('chart-item-qty');
  if(donutEl1&&iLabels.length){
    window._chartItemAmt=new Chart(donutEl1,{type:'doughnut',
      data:{labels:iLabels,datasets:[{data:iLabels.map(l=>amtMap[l]||0),backgroundColor:bgC,borderColor:bdC,borderWidth:1}]},
      options:{responsive:true,maintainAspectRatio:true,aspectRatio:0.9,layout:{padding:35},
        plugins:{legend:{display:true,position:'bottom',labels:{font:{size:10},boxWidth:10}},
          tooltip:{callbacks:{label:c=>{const tot=c.dataset.data.reduce((a,b)=>a+b,0);return ' '+c.label+': '+fmtS(c.parsed)+'원 ('+Math.round(c.parsed/tot*100)+'%)';}}}}}});
  }
  if(donutEl2&&iLabels.length){
    window._chartItemQty=new Chart(donutEl2,{type:'doughnut',
      data:{labels:iLabels,datasets:[{data:iLabels.map(l=>qtyMap[l]||0),backgroundColor:bgC,borderColor:bdC,borderWidth:1}]},
      options:{responsive:true,maintainAspectRatio:true,aspectRatio:0.9,layout:{padding:35},
        plugins:{legend:{display:true,position:'bottom',labels:{font:{size:10},boxWidth:10}},
          tooltip:{callbacks:{label:c=>{const tot=c.dataset.data.reduce((a,b)=>a+b,0);return ' '+c.label+': '+fmt(c.parsed)+'박스 ('+Math.round(c.parsed/tot*100)+'%)';}}}}}});
  }
};


// ===== 세금계산서 팝업 =====
window.showTaxInvoice = function() {
  const modal = document.getElementById('tax-modal');
  if (!modal) return;
  // 현재 정산 탭의 년월 기본값 설정
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('tax-month').value = ym;
  modal.style.display = 'block';
  runTaxInvoice();
};
window.closeTaxModal = function() {
  document.getElementById('tax-modal').style.display = 'none';
};
window.runTaxInvoice = function() {
  const ym = document.getElementById('tax-month').value;
  if (!ym) return;
  const from = ym + '-01';
  const lastDay = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).getDate();
  const to = ym + '-' + String(lastDay).padStart(2,'0');
  const wrap = document.getElementById('tax-result');

  // 거래처별 월 합계
  const partnerMap = {};
  Object.entries(orders).forEach(([date, rows]) => {
    if (date < from || date > to) return;
    rows.forEach(r => {
      if (!partnerMap[r.partner]) partnerMap[r.partner] = { qty: 0, amt: 0 };
      partnerMap[r.partner].qty += r.qty;
      partnerMap[r.partner].amt += r.amt;
    });
  });

  const list = Object.entries(partnerMap).sort((a,b) => b[1].amt - a[1].amt);
  if (!list.length) {
    wrap.innerHTML = '<div class="nodata">해당 월 거래 내역이 없습니다</div>';
    return;
  }

  const total = list.reduce((a,[,v]) => a + v.amt, 0);
  const totalQty = list.reduce((a,[,v]) => a + v.qty, 0);
  const [y, m] = ym.split('-');

  let html = `
    <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:13px;color:var(--t2);">${y}년 ${parseInt(m)}월 · 총 ${list.length}개 거래처</span>
      <span style="font-size:14px;font-weight:600;color:var(--grn);">합계 ${fmt(total)}원</span>
    </div>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#e8f5e9;">
          <th style="padding:9px 12px;text-align:left;font-weight:600;color:#14532d;border-bottom:2px solid #86efac;">거래처</th>
          <th style="padding:9px 12px;text-align:right;font-weight:600;color:#14532d;border-bottom:2px solid #86efac;">수량(박스)</th>
          <th style="padding:9px 12px;text-align:right;font-weight:600;color:#14532d;border-bottom:2px solid #86efac;">공급가액(원)</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(([name, v], i) => `
          <tr style="background:${i%2===0?'#fff':'#f9fafb'};border-bottom:1px solid #e5e7eb;">
            <td style="padding:9px 12px;font-family:monospace;font-weight:600;">${name}</td>
            <td style="padding:9px 12px;text-align:right;">${fmt(v.qty)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:500;">${fmt(v.amt)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#dcfce7;border-top:2px solid #86efac;">
          <td style="padding:10px 12px;font-weight:700;color:#14532d;">합계</td>
          <td style="padding:10px 12px;text-align:right;font-weight:700;color:#14532d;">${fmt(totalQty)}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:700;color:#14532d;">${fmt(total)}</td>
        </tr>
      </tfoot>
    </table>
    </div>
    <div style="padding:12px 14px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--bd);">
      <button class="btn btn-g btn-s" onclick="copyTaxTable('${ym}')">📋 텍스트 복사</button>
    </div>`;
  wrap.innerHTML = html;
};

window.copyTaxTable = function(ym) {
  const [y, m] = ym.split('-');
  const from = ym + '-01';
  const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
  const to = ym + '-' + String(lastDay).padStart(2,'0');
  const partnerMap = {};
  Object.entries(orders).forEach(([date, rows]) => {
    if (date < from || date > to) return;
    rows.forEach(r => {
      if (!partnerMap[r.partner]) partnerMap[r.partner] = { qty: 0, amt: 0 };
      partnerMap[r.partner].qty += r.qty;
      partnerMap[r.partner].amt += r.amt;
    });
  });
  const list = Object.entries(partnerMap).sort((a,b) => b[1].amt - a[1].amt);
  const total = list.reduce((a,[,v]) => a + v.amt, 0);
  const totalQty = list.reduce((a,[,v]) => a + v.qty, 0);
  let text = `${y}년 ${parseInt(m)}월 세금계산서 요약\n`;
  text += '='.repeat(35) + '\n';
  text += `거래처\t수량\t공급가액\n`;
  text += '-'.repeat(35) + '\n';
  list.forEach(([name, v]) => { text += `${name}\t${fmt(v.qty)}\t${fmt(v.amt)}원\n`; });
  text += '='.repeat(35) + '\n';
  text += `합계\t${fmt(totalQty)}\t${fmt(total)}원`;
  navigator.clipboard.writeText(text).then(() => alert('클립보드에 복사했습니다!'));
};

// ===== 폰트 크기 조절 =====
let tableFontScale = 100; // 기본 100%
window.adjustFontSize = function(dir) {
  if (dir === 0) { tableFontScale = 100; }
  else { tableFontScale = Math.max(70, Math.min(150, tableFontScale + dir * 5)); }
  localStorage.setItem('onion_font_scale', tableFontScale);
  applyFontScale();
};
function applyFontScale() {
  const scale = tableFontScale / 100;
  // 주문 테이블 폰트 크기 적용
  const style = document.getElementById('font-scale-style') || (() => {
    const s = document.createElement('style'); s.id = 'font-scale-style';
    document.head.appendChild(s); return s;
  })();
  style.textContent = `.otbl td { font-size: ${Math.round(12 * scale)}px !important; }
    .otbl th { font-size: ${Math.round(11 * scale)}px !important; }
    .qinp { font-size: ${Math.round(11 * scale)}px !important; }
    .pricinp { font-size: ${Math.round(10 * scale)}px !important; }
    .ibadge { font-size: ${Math.round(10 * scale)}px !important; }`;
  const lbl = document.getElementById('font-size-lbl');
  const val = document.getElementById('font-size-val');
  if (lbl) lbl.textContent = tableFontScale === 100 ? '기본 (100%)' : `${tableFontScale}%`;
  if (val) val.textContent = tableFontScale + '%';
}

// ===== 정산 =====
function fillSettleSel() {
  const sel=document.getElementById('sep');sel.innerHTML='<option value="all">전체</option>';
  partners.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});
}
const wkStart=ds=>{const d=new Date(ds);d.setDate(d.getDate()-d.getDay());return d.toISOString().slice(0,10);};
const wkLabel=sun=>{const d=new Date(sun),s=`${d.getMonth()+1}/${d.getDate()}`;d.setDate(d.getDate()+6);return `${s}~${d.getMonth()+1}/${d.getDate()}`;};
window.runSettle = function() {
  const from=document.getElementById('sef').value, to=document.getElementById('set').value;
  const fp=document.getElementById('sep').value, mode=document.getElementById('sem').value;
  if(!from||!to){document.getElementById('setres').innerHTML='<div class="nodata">기간을 선택해 주세요</div>';return;}
  const all=[];
  Object.entries(orders).forEach(([date,rows])=>{if(date<from||date>to)return;rows.forEach(r=>{if(fp!=='all'&&r.partner!==fp)return;all.push({date,...r});});});
  if(!all.length){document.getElementById('setres').innerHTML='<div class="nodata">데이터가 없습니다</div>';return;}
  const pList=fp==='all'?[...new Set(all.map(r=>r.partner))].sort():[fp];
  let html='';
  pList.forEach(pn=>{
    const pRows=all.filter(r=>r.partner===pn);if(!pRows.length)return;
    const grps={};
    pRows.forEach(r=>{
      const gk=mode==='weekly'?wkStart(r.date):r.date.slice(0,7);
      if(!grps[gk])grps[gk]={days:{}};
      if(!grps[gk].days[r.date])grps[gk].days[r.date]={items:[],qty:0,amt:0};
      grps[gk].days[r.date].items.push(r);grps[gk].days[r.date].qty+=r.qty;grps[gk].days[r.date].amt+=r.amt;
    });
    const tQ=pRows.reduce((a,r)=>a+r.qty,0), tA=pRows.reduce((a,r)=>a+r.amt,0);
    let rows='';
    Object.keys(grps).sort().forEach(gk=>{
      const g=grps[gk], gl=mode==='weekly'?wkLabel(gk):gk;
      const gQ=Object.values(g.days).reduce((a,d)=>a+d.qty,0), gA=Object.values(g.days).reduce((a,d)=>a+d.amt,0);
      rows+=`<tr class="sg"><td colspan="2">${mode==='weekly'?'주':'월'}: ${gl}</td><td class="tr">${fmt(gQ)}</td><td class="tr">${fmt(gA)}</td></tr>`;
      Object.keys(g.days).sort().forEach(day=>{
        const dd=g.days[day], dow=['일','월','화','수','목','금','토'][new Date(day).getDay()], isSun=new Date(day).getDay()===0;
        rows+=`<tr class="sd"><td style="color:${isSun?'#c00':'#222'};">${day.slice(5)}(${dow})</td><td></td><td class="tr">${fmt(dd.qty)}</td><td class="tr" style="font-weight:600;">${fmt(dd.amt)}</td></tr>`;
        dd.items.forEach(r=>{rows+=`<tr class="si"><td>${r.itemName}</td><td class="tr">${fmt(r.price)}</td><td class="tr">${fmt(r.qty)}</td><td class="tr">${fmt(r.amt)}</td></tr>`;});
      });
    });
    rows+=`<tr class="st"><td colspan="2">합계</td><td class="tr">${fmt(tQ)}박스</td><td class="tr">${fmt(tA)}원</td></tr>`;
    html+=`<div class="setcard"><div class="setph"><span style="font-size:14px;font-weight:600;font-family:monospace;">${pn}</span><span style="font-size:11px;color:#6b7280;">${from}~${to}</span></div>
      <div style="overflow-x:auto;"><table class="settbl" style="min-width:260px;">
        <thead><tr><th>날짜</th><th class="tr">단가</th><th class="tr">수량</th><th class="tr">금액</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
  });
  document.getElementById('setres').innerHTML=html;
};

// ===== 설정 =====
function renderItemSettings() {
  document.getElementById('ilist').innerHTML=items.map(it=>{
    const c=colorOf(it.id);
    return `<div style="display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--bd);">
      <span style="font-size:11px;font-weight:500;padding:2px 7px;border-radius:20px;background:${c.bg};color:${c.tc};flex:1;">${it.name}${it.active===false?' (비활성)':''}</span>
      ${it.active!==false
        ?`<button class="btn btn-a btn-s" style="font-size:11px;" onclick="deactivateItem(${it.id})">비활성화</button>`
        :`<button class="btn btn-g btn-s" style="font-size:11px;" onclick="restoreItem(${it.id})">복원</button>`}
    </div>`;
  }).join('');
}
window.addItem = function() {
  const n=document.getElementById('new-item').value.trim(); if(!n)return;
  items.push({id:nextItemId,name:n,active:true}); nextItemId++;
  document.getElementById('new-item').value='';
  renderItemSettings(); renderPriceGrid(); renderItemTabs();
  scheduleSync(saveItems);
};
window.deactivateItem = function(id) {
  const it=items.find(x=>x.id===id); if(!it)return;
  if(!confirm(`'${it.name}' 비활성화합니까?
과거 매출 데이터는 완전히 보존됩니다.`))return;
  it.active=false;
  // ★ 현재 입력 화면의 state만 초기화 (과거 orders 데이터는 절대 건드리지 않음)
  partners.forEach((_,pi)=>{if(state[pi])state[pi]=state[pi].map(s=>s.itemId===id?{itemId:0,customPrice:null,qty:0}:s);});
  renderItemSettings(); renderPriceGrid(); renderItemTabs(); renderTable();
  scheduleSync(saveItems);
};
window.restoreItem = function(id) {
  items.find(x=>x.id===id).active=true;
  renderItemSettings(); renderPriceGrid(); renderItemTabs(); renderTable();
  scheduleSync(saveItems);
};
function renderPartnerSettings() {
  document.getElementById('plist').innerHTML=partners.map((name,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd);">
      <span style="font-family:monospace;font-size:13px;font-weight:500;">${name}</span>
      <button class="btn btn-r btn-s" style="font-size:11px;" onclick="deletePartner(${i})">삭제</button>
    </div>`).join('');
}
window.addPartner = function() {
  const name=document.getElementById('new-partner').value.trim(); if(!name)return;
  partners.push(name); state[partners.length-1]=[{itemId:0,customPrice:null,qty:0}];
  document.getElementById('new-partner').value='';
  renderPartnerSettings(); renderTable(); fillSettleSel();
  scheduleSync(savePartners);
};
window.deletePartner = function(idx) {
  if(!confirm(`'${partners[idx]}' 삭제합니까?`))return;
  partners.splice(idx,1);
  for(let i=idx;i<partners.length;i++) state[i]=state[i+1]||[{itemId:0,customPrice:null,qty:0}];
  delete state[partners.length];
  renderPartnerSettings(); renderTable(); fillSettleSel();
  scheduleSync(savePartners);
};

// ===== JSON 백업 =====
window.exportData = function() {
  const data={version:'3.0',exportDate:new Date().toISOString(),items,partners,orders,prices,memos};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`onion_backup_${today()}.json`; a.click();
  URL.revokeObjectURL(url);
};
window.importData = function() {
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
  inp.onchange=async e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const d=JSON.parse(ev.target.result);
        if(!confirm('기존 클라우드 데이터를 덮어씁니다. 계속합니까?'))return;
        setSyncStatus('ing','복원 중...');
        const batch=writeBatch(db);
        if(d.orders) Object.entries(d.orders).forEach(([date,rows])=>{batch.set(doc(db,'orders',date),{rows,updatedAt:new Date().toISOString()});});
        if(d.prices) Object.entries(d.prices).forEach(([date,map])=>{batch.set(doc(db,'prices',date),{map,updatedAt:new Date().toISOString()});});
        if(d.memos)  Object.entries(d.memos).forEach(([date,content])=>{batch.set(doc(db,'memos',date),{content,updatedAt:new Date().toISOString()});});
        await batch.commit();
        if(d.orders) Object.assign(orders,d.orders);
        if(d.prices) Object.assign(prices,d.prices);
        if(d.memos)  Object.assign(memos,d.memos);
        setSyncStatus('ok','복원 완료 ✓');
        alert('가져오기 완료!');
        loadDay(document.getElementById('order-date').value);
      }catch{ setSyncStatus('err','복원 실패'); alert('파일 형식 오류'); }
    }; reader.readAsText(file);
  }; inp.click();
};
