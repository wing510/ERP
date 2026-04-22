/**
 * Login Overlay（帳號 + 密碼）
 * - 後端 action: login 驗證；成功後 setCurrentUser + 同步 topbar
 */
(function(){
  /**
   * 後端 login 的 jsonSuccess 為 { success, user_id, user_name, role, status }（欄位在頂層）；
   * 若未來改為 { success, data: {...} } 亦相容。
   */
  function erpNormalizeLoginResult_(r){
    if(!r || r.success !== true) return null;
    var d = r.data;
    if(d && typeof d === "object" && !Array.isArray(d)) return d;
    return {
      user_id: r.user_id,
      user_name: r.user_name,
      role: r.role,
      status: r.status,
      remember: !!r.remember,
      session_token: r.session_token,
      session_expires_at: r.session_expires_at
    };
  }

  function getGoogleClientId_(){
    try{
      var cfg = window.__ERP_CONFIG__ || null;
      var id = cfg && typeof cfg.GOOGLE_CLIENT_ID === "string" ? String(cfg.GOOGLE_CLIENT_ID || "").trim() : "";
      return id;
    }catch(_e){
      return "";
    }
  }

  var overlay = null;
  var input = null;
  var pwInput = null;
  var pwToggleBtn = null;
  var rememberCk = null;
  var errBox = null;
  var btnSubmit = null;
  var btnClear = null;
  var lastAuthedUserId = "";

  function escHtml_(s){
    return String(s ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function showError(msg){
    if(!errBox) return;
    errBox.innerHTML = escHtml_(msg || "");
    errBox.classList.toggle("show", !!msg);
  }

  function setOpen(open){
    if(!overlay) overlay = document.getElementById("loginOverlay");
    if(!overlay) return;
    overlay.classList.toggle("active", !!open);
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
    if(open && input){
      setTimeout(function(){ try{ input.focus(); input.select(); }catch(_e){} }, 0);
    }
  }

  function setLocked(locked){
    try{
      document.body.classList.toggle("erp-locked", !!locked);
    }catch(_e){}
  }

  function normalizeId(id){
    return String(id || "").trim();
  }

  function syncTopbarUserLabel(userId){
    try{
      var el = document.getElementById("topbarCurrentUser");
      if(!el) return;
      var uid = String(userId || "").trim();
      el.textContent = uid || "—";
      el.title = uid ? ("目前登入：" + uid) : "";
    }catch(_e){}
  }

  /** 密碼隱藏 → 斜線遮眼；密碼顯示 → 睜眼 */
  function syncPwToggleIcon_(){
    if(!pwToggleBtn || !pwInput) return;
    var hidden = (pwInput.getAttribute("type") || "password") === "password";
    pwToggleBtn.setAttribute("data-state", hidden ? "hidden" : "visible");
    pwToggleBtn.setAttribute("title", hidden ? "顯示密碼" : "隱藏密碼");
    pwToggleBtn.setAttribute("aria-label", hidden ? "顯示密碼" : "隱藏密碼");
  }

  function clearLoginForm_(){
    showError("");
    try{ if(input) input.value = ""; }catch(_e){}
    try{ if(pwInput) pwInput.value = ""; }catch(_e2){}
    try{ if(pwInput) pwInput.setAttribute("type","password"); }catch(_e4){}
    syncPwToggleIcon_();
  }

  async function doLogin(){
    if(!input) return;
    var id = normalizeId(input.value);
    if(!id){
      showError("請輸入使用者 ID");
      return;
    }
    var pw = String(pwInput && pwInput.value != null ? pwInput.value : "").trim();
    if(!pw){
      showError("請輸入密碼");
      return;
    }
    btnSubmit && (btnSubmit.disabled = true);
    btnClear && (btnClear.disabled = true);
    try{
      if(typeof callAPI !== "function"){
        showError("系統尚未初始化完成，請稍後再試。");
        return;
      }
      try{
        var remember = true;
        try{ remember = rememberCk ? !!rememberCk.checked : true; }catch(_eRemember){ remember = true; }
        var r = await callAPI(
          { action: "login", user_id: id, password: pw, remember_me: remember ? "1" : "0" },
          { method: "POST", timeout_ms: 60000 }
        );
        var u = erpNormalizeLoginResult_(r);
        var uid = String(u && u.user_id ? u.user_id : id).trim();
        var st = String(u && u.status ? u.status : "ACTIVE").trim().toUpperCase();
        if(st !== "ACTIVE"){
          showError("此使用者為停用（INACTIVE），不可登入。");
          return;
        }
        lastAuthedUserId = uid;
        var roleFromServer = String(u && u.role != null ? u.role : "").trim();
        var tok = String(u && u.session_token ? u.session_token : "").trim();
        if(tok && typeof setSessionToken === "function") setSessionToken(tok, remember);
        if(typeof setCurrentUser === "function") setCurrentUser(uid, { remember: remember, role: roleFromServer });
        syncTopbarUserLabel(uid);
        showError("");
        setOpen(false);
        setLocked(false);
        try{
          if(typeof navigate === "function") navigate("dashboard");
        }catch(_eNav){}
        try{ if(typeof showToast === "function") showToast("已登入：" + uid); }catch(_e2){}
      }catch(err){
        var msg = String(err && err.message != null ? err.message : err || "").trim();
        // 後端回傳的代碼（loginUser）：NOT_FOUND / BAD_PASSWORD / NO_PASSWORD / INACTIVE / Users sheet missing password column...
        if(msg === "NOT_FOUND"){
          showError("找不到此使用者。");
          return;
        }
        if(msg === "BAD_PASSWORD"){
          showError("密碼錯誤。");
          return;
        }
        if(msg === "USE_SESSION_RESUME"){
          showError("請重新整理頁面，或先登出再以密碼登入。");
          return;
        }
        if(msg === "NO_PASSWORD"){
          showError("此帳號尚未設定密碼，請先到 Google Sheet 的 Users 主檔設定 password 欄位。");
          return;
        }
        if(msg === "INACTIVE"){
          showError("此使用者為停用（INACTIVE），不可登入。");
          return;
        }
        if(/missing password column/i.test(msg) || /password column/i.test(msg)){
          showError("Users 主檔缺少 password 欄位。請先在 Google Sheet 新增 password 欄位並重新部署後端。");
          return;
        }
        showError(msg || "登入失敗，請稍後再試。");
        return;
      }
    }finally{
      btnSubmit && (btnSubmit.disabled = false);
      btnClear && (btnClear.disabled = false);
    }
  }

  async function doGoogleLogin(idToken){
    var remember = true;
    try{ remember = rememberCk ? !!rememberCk.checked : true; }catch(_eRemember){ remember = true; }
    try{
      if(typeof callAPI !== "function"){
        showError("系統尚未初始化完成，請稍後再試。");
        return;
      }
      var r = await callAPI(
        { action: "google_login", id_token: String(idToken || ""), remember_me: remember ? "1" : "0" },
        { method: "POST", timeout_ms: 60000 }
      );
      var u = erpNormalizeLoginResult_(r);
      var uid = String(u && u.user_id ? u.user_id : "").trim();
      var st = String(u && u.status ? u.status : "ACTIVE").trim().toUpperCase();
      if(!uid || st !== "ACTIVE"){
        showError("此帳號不可登入（未授權或停用）。");
        return;
      }
      lastAuthedUserId = uid;
      var roleFromServer = String(u && u.role != null ? u.role : "").trim();
      var tok = String(u && u.session_token ? u.session_token : "").trim();
      if(tok && typeof setSessionToken === "function") setSessionToken(tok, remember);
      if(typeof setCurrentUser === "function") setCurrentUser(uid, { remember: remember, role: roleFromServer });
      syncTopbarUserLabel(uid);
      showError("");
      setOpen(false);
      setLocked(false);
      try{ if(typeof navigate === "function") navigate("dashboard"); }catch(_eNav){}
      try{ if(typeof showToast === "function") showToast("已登入：" + uid); }catch(_e2){}
    }catch(err){
      var msg = String(err && err.message != null ? err.message : err || "").trim();
      if(msg === "NOT_ALLOWED"){
        showError("此 Google 帳號不在允許名單內。");
        return;
      }
      if(msg === "BAD_ID_TOKEN" || msg === "BAD_AUD"){
        showError("Google 登入驗證失敗（請聯絡管理員）。");
        return;
      }
      showError(msg || "Google 登入失敗，請稍後再試。");
    }
  }

  async function ensureLoggedIn(){
    overlay = document.getElementById("loginOverlay");
    input = document.getElementById("loginUserId");
    pwInput = document.getElementById("loginPassword");
    pwToggleBtn = document.getElementById("loginPwToggle");
    rememberCk = document.getElementById("loginRemember");
    errBox = document.getElementById("loginError");
    btnSubmit = document.getElementById("loginSubmitBtn");
    btnClear = document.getElementById("loginClearBtn");
    var loginForm = document.getElementById("loginForm");
    if(!overlay || !input || !pwInput || !btnSubmit || !btnClear) return;

    if(loginForm && !loginForm.dataset.boundSubmit){
      loginForm.dataset.boundSubmit = "1";
      loginForm.addEventListener("submit", function(e){
        e.preventDefault();
        doLogin();
      });
    }else if(!loginForm){
      btnSubmit.addEventListener("click", function(){ doLogin(); });
    }
    btnClear.addEventListener("click", function(){ clearLoginForm_(); });
    if(pwToggleBtn && !pwToggleBtn.dataset.bound){
      pwToggleBtn.dataset.bound = "1";
      pwToggleBtn.addEventListener("click", function(){
        try{
          var isPw = (pwInput.getAttribute("type") || "password") === "password";
          pwInput.setAttribute("type", isPw ? "text" : "password");
          syncPwToggleIcon_();
        }catch(_e){}
      });
    }
    syncPwToggleIcon_();

    setLocked(true);

    // Google Sign-In button（若有設定 client id）
    try{
      var gWrap = document.getElementById("googleSignInWrap");
      var gBtn = document.getElementById("googleSignInBtn");
      var cid = getGoogleClientId_();
      // 只要設定了 client id，就先顯示區塊；等 Google 腳本載入完成再 render（避免 async defer timing 造成「看不到按鈕」）
      if(gWrap) gWrap.style.display = cid ? "" : "none";
      if(gBtn && cid && !gBtn.dataset.inited){
        (function tryInitGoogleBtn_(){
          try{
            if(!(window.google && google.accounts && google.accounts.id)){
              // 最多等 10 秒（100 * 100ms），避免無限輪詢
              var left = Number(gBtn.dataset.gsiWaitLeft || "100");
              if(left <= 0) return;
              gBtn.dataset.gsiWaitLeft = String(left - 1);
              setTimeout(tryInitGoogleBtn_, 100);
              return;
            }
            // 避免重複 init/render
            gBtn.dataset.inited = "1";
            google.accounts.id.initialize({
              client_id: cid,
              callback: function(resp){
                try{
                  var tok = resp && resp.credential ? String(resp.credential || "").trim() : "";
                  if(!tok) return;
                  doGoogleLogin(tok);
                }catch(_e){}
              }
            });
            google.accounts.id.renderButton(gBtn, { theme: "outline", size: "large", text: "signin_with" });
          }catch(_e2){}
        })();
      }
    }catch(_eG){}

    var tokResume = "";
    try{
      tokResume = typeof getSessionToken === "function" ? String(getSessionToken() || "").trim() : "";
    }catch(_eTok){}
    if(tokResume){
      try{
        if(typeof callAPI === "function"){
          var rr = await callAPI(
            { action: "session_resume", session_token: tokResume },
            { method: "POST", timeout_ms: 60000 }
          );
          var uu = erpNormalizeLoginResult_(rr);
          var st2 = String(uu && uu.status ? uu.status : "").trim().toUpperCase();
          if(uu && uu.user_id && st2 === "ACTIVE"){
            lastAuthedUserId = String(uu.user_id).trim();
            var roleSess = String(uu.role != null ? uu.role : "").trim();
            var remSess = !!uu.remember;
            if(typeof setCurrentUser === "function"){
              setCurrentUser(lastAuthedUserId, { remember: remSess, role: roleSess });
            }
            syncTopbarUserLabel(lastAuthedUserId);
            setOpen(false);
            setLocked(false);
            try{
              if(typeof navigate === "function") navigate("dashboard");
            }catch(_eNav2){}
            return;
          }
        }
      }catch(_eSess){
        try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_c){}
      }
      try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_c2){}
    }

    setOpen(true);
  }

  async function doLogout(){
    try{
      if(typeof callAPI === "function" && typeof getSessionToken === "function"){
        var t = String(getSessionToken() || "").trim();
        if(t){
          await callAPI({ action: "session_logout", session_token: t }, { method: "POST", timeout_ms: 30000 });
        }
      }
    }catch(_eLo){}
    if(typeof setCurrentUser === "function") setCurrentUser("");
    else{
      try{ localStorage.removeItem("erp_current_user"); }catch(_e){}
      try{ sessionStorage.removeItem("erp_current_user"); }catch(_eSess){}
      try{ localStorage.removeItem("erp_current_role"); }catch(_eR){}
      try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR2){}
    }
    syncTopbarUserLabel("");
    if(!overlay) overlay = document.getElementById("loginOverlay");
    if(!input) input = document.getElementById("loginUserId");
    if(!pwInput) pwInput = document.getElementById("loginPassword");
    if(!pwToggleBtn) pwToggleBtn = document.getElementById("loginPwToggle");
    if(!rememberCk) rememberCk = document.getElementById("loginRemember");
    if(!errBox) errBox = document.getElementById("loginError");
    showError("");
    setLocked(true);
    setOpen(true);
    clearLoginForm_();
    try{
      if(typeof navigate === "function") navigate("dashboard");
    }catch(_eNav3){}
  }

  /** doLogout 若拋錯時，仍強制清 session + 顯示登入遮罩（不依賴 closure 變數） */
  function fallbackLogoutDom_(){
    try{ if(typeof clearSessionToken === "function") clearSessionToken(); }catch(_cs){}
    if(typeof setCurrentUser === "function") setCurrentUser("");
    else{
      try{ localStorage.removeItem("erp_current_user"); }catch(_e){}
      try{ sessionStorage.removeItem("erp_current_user"); }catch(_e2){}
      try{ localStorage.removeItem("erp_current_role"); }catch(_eR){}
      try{ sessionStorage.removeItem("erp_current_role"); }catch(_eR2){}
    }
    try{ document.body.classList.add("erp-locked"); }catch(_e3){}
    try{ document.body.style.overflow = "hidden"; }catch(_e4){}
    var ov = document.getElementById("loginOverlay");
    if(ov){
      ov.classList.add("active");
      ov.setAttribute("aria-hidden","false");
    }
    var u = document.getElementById("loginUserId");
    var p = document.getElementById("loginPassword");
    if(u) u.value = "";
    if(p){
      p.value = "";
      p.setAttribute("type","password");
    }
    var er = document.getElementById("loginError");
    if(er){
      er.innerHTML = "";
      er.classList.remove("show");
    }
    var tb = document.getElementById("loginPwToggle");
    if(tb){
      tb.setAttribute("data-state","hidden");
      tb.setAttribute("title","顯示密碼");
      tb.setAttribute("aria-label","顯示密碼");
    }
    syncTopbarUserLabel("");
  }

  /**
   * 登出改由腳本綁定（勿用 HTML onclick：部分環境 CSP 會擋 inline handler，導致按鈕完全沒反應）
   */
  function bindLogoutBtn_(){
    async function performLogout(){
      try{
        await doLogout();
      }catch(err){
        try{ console.error("[ERP] logout", err); }catch(_e2){}
        fallbackLogoutDom_();
      }
    }
    try{ window.erpLogout = doLogout; }catch(_e0){}
    try{ window.erpPerformLogout = performLogout; }catch(_e1){}

    var btn = document.getElementById("logoutBtn");
    if(!btn || btn.getAttribute("data-erp-logout-bound") === "1") return;
    btn.setAttribute("data-erp-logout-bound","1");
    try{ btn.removeAttribute("onclick"); }catch(_e){}

    btn.addEventListener("click", function(ev){
      if(ev){
        ev.preventDefault();
        ev.stopPropagation();
      }
      performLogout();
    }, false);
  }

  try{ window.erpEnsureLoggedIn = ensureLoggedIn; }catch(_e){}

  function startErpLogin_(){
    bindLogoutBtn_();
    ensureLoggedIn();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", startErpLogin_);
  }else{
    startErpLogin_();
  }

  /* 極晚再綁一次：避免主版被改動、腳本順序異常時按鈕尚未插入 DOM */
  setTimeout(function(){ bindLogoutBtn_(); }, 0);
})();
