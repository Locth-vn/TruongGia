(function () {
  'use strict';

  const STORAGE_KEY = 'giapha-data-v4';
  const NODE_W = 204, NODE_H = 92, COUPLE_GAP = 12, SIBLING_GAP = 30, LEVEL_GAP = 116, MARGIN = 240;

  const $ = (id) => document.getElementById(id);

  const el = {
    canvas: $('canvas'), viewport: $('viewport'), links: $('links'), cards: $('cards'),
    search: $('searchInput'), details: $('detailsPanel'), emptyState: $('emptyState'),
    zoomLabel: $('zoomLabel'), modalOverlay: $('modalOverlay'), modalTitle: $('modalTitle'),
    form: $('personForm'), fName: $('fName'), fGender: $('fGender'), fBirth: $('fBirth'),
    fDeath: $('fDeath'), fPhoto: $('fPhoto'), btnPhoto: $('btnPhoto'), photoPreview: $('photoPreview'),
    fFather: $('fFather'), fMother: $('fMother'), fSpouses: $('fSpouses'), fNote: $('fNote'),
    fHometown: $('fHometown'), fJob: $('fJob'), fAddress: $('fAddress'), fPhone: $('fPhone'), fEmail: $('fEmail'),
    aPw1: $('aPw1'), aPw2: $('aPw2'), aPw: $('aPw'),
    bellPanel: $('bellPanel'), bellBadge: $('bellBadge'), announceOverlay: $('announceOverlay'),
    authOverlay: $('authOverlay')
  };

  const ICONS = {
    pencil: '<svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12z"/></svg>'
  };

  const GENDER = {
    m: { label: 'Nam', cls: 'male' },
    f: { label: 'Nữ', cls: 'female' },
    o: { label: 'Khác', cls: 'other' }
  };

  let people = [];
  let announcements = [];
  let collapsed = new Set();
  let selectedId = null;
  let editingId = null;
  let photoData = null;
  let lastPositions = new Map();
  let lastBBox = { x: 0, y: 0, w: 100, h: 100 };
  let view = { x: 0, y: 0, scale: 1 };
  let panState = null;
  let lastPanMoved = false;
  let currentUser = null;
  let accounts = [];
  let editingAnnId = null;
  let annPhotoData = null;

  function uid() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function byId(id) { return people.find((p) => p.id === id) || null; }

  function childrenOf(id) {
    return people
      .filter((p) => (p.parents || []).includes(id))
      .sort((a, b) => String(a.birth || '').localeCompare(String(b.birth || ''), undefined, { numeric: true }));
  }

  function descendantIds(id, acc) {
    acc = acc || new Set();
    childrenOf(id).forEach((k) => {
      if (!acc.has(k.id)) { acc.add(k.id); descendantIds(k.id, acc); }
    });
    return acc;
  }

  function descendantCount(id) { return descendantIds(id).size; }

  function parseYear(s) {
    const m = String(s || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
  }

  function parseDate(s) {
    const str = String(s || '').trim();
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
    m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return { y: parseInt(m[3], 10), mo: parseInt(m[2], 10), d: parseInt(m[1], 10) };
    m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return { y: null, mo: parseInt(m[2], 10), d: parseInt(m[1], 10) };
    return null;
  }

  function formatDateVN(s) {
    const dt = parseDate(s);
    if (!dt) return String(s || '');
    return (dt.d < 10 ? '0' + dt.d : dt.d) + '/' + (dt.mo < 10 ? '0' + dt.mo : dt.mo) + (dt.y ? '/' + dt.y : '');
  }

  function isDeceased(p) {
    return !!(p && p.death && String(p.death).trim());
  }

  function nextOccurrence(mo, d) {
    const now = new Date();
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    let date = new Date(now.getFullYear(), mo - 1, d);
    if (date < startOfDay(now)) date = new Date(now.getFullYear() + 1, mo - 1, d);
    return { date: date, days: Math.round((date - startOfDay(now)) / 86400000) };
  }

  function upcomingEvents() {
    const evts = [];
    people.forEach((p) => {
      const b = parseDate(p.birth);
      if (b && b.mo && b.d && !isDeceased(p)) {
        const o = nextOccurrence(b.mo, b.d);
        if (o.days <= 30) {
          const by = parseYear(p.birth);
          evts.push({ type: 'birthday', days: o.days, date: o.date, person: p, age: by ? o.date.getFullYear() - by : null });
        }
      }
      const dd = parseDate(p.death);
      if (dd && dd.mo && dd.d) {
        const o = nextOccurrence(dd.mo, dd.d);
        if (o.days <= 30) evts.push({ type: 'memorial', days: o.days, date: o.date, person: p });
      }
    });
    return evts.sort((a, b) => a.days - b.days);
  }

  function yearsStr(p) {
    const b = parseYear(p.birth), d = parseYear(p.death);
    if (!b && !d) return '';
    return (b || '?') + ' – ' + (d || 'nay');
  }

  function isoInDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function sampleData() {
    const mk = (id, name, gender, birth, death, parents, spouses, note, extra) => ({
      id, name, gender,
      birth: birth || '', death: death || '',
      parents: parents || [], spouses: spouses || [],
      note: note || '', photo: null,
      hometown: '', job: '', address: '', phone: '', email: '',
      ...(extra || {})
    });
    return [
      mk('tbang', 'Trương Đình Bảng', 'm', '26/03/1944', '', [], ['llechi'], 'Ông nội', {}),
      mk('llechi', 'Hoàng Thị Lệ Chi', 'f', '26/03/1944', '10/01/2021', [], ['tbang'], 'Bà nội', {}),
      mk('tdung', 'Trương Hoàng Dung', 'f', '', '', ['tbang', 'llechi'], ['pdnhiem'], 'Con ruột 1', {}),
      mk('pdnhiem', 'Phạm Đình Nhiệm', 'm', '', '', [], ['tdung'], 'Chồng chị 1', {}),
      mk('pcuong', 'Phạm Minh Cường', 'm', '08/10/2000', '', ['pdnhiem', 'tdung'], [], 'Con 1 chị 1', {}),
      mk('pnhann', 'Phạm Thùy Nhàn', 'f', '', '', ['pdnhiem', 'tdung'], [], 'Con 2 chị 1', {}),
      mk('tnguyen', 'Trương Hoàng Nguyên', 'm', '', '', ['tbang', 'llechi'], ['ldiem'], 'Con ruột 2', {}),
      mk('ldiem', 'Lê Quang Ánh Diễm', 'f', '', '', [], ['tnguyen'], 'Vợ trai 2', {}),
      mk('tbach', 'Trương Lê Bách', 'm', '', '', ['tnguyen', 'ldiem'], [], 'Con 1 trai 2', {}),
      mk('thuydung', 'Trương Hoàng Thùy Dung', 'f', '', '', ['tbang', 'llechi'], ['dcuong'], 'Con ruột 3', {}),
      mk('dcuong', 'Đặng Đức Cương', 'm', '', '', [], ['thuydung'], 'Chồng con 3', {}),
      mk('dkhoi', 'Đặng Đức Khôi', 'm', '', '', ['dcuong', 'thuydung'], [], 'Con 1 chị 3', {}),
      mk('tloc', 'Trương Hoàng Lộc', 'm', '19/02/1985', '', ['tbang', 'llechi'], ['thoai'], 'Con ruột 4', {}),
      mk('thoai', 'Nguyễn Thị Thúy Hoài', 'f', '16/06/1985', '', [], ['tloc'], 'Vợ trai 4', {}),
      mk('tkhoa', 'Trương Đăng Khoa', 'm', '19/05/2014', '', ['tloc', 'thoai'], [], 'Con 1 trai 4', {}),
      mk('than', 'Trương Hoàng Hoài An', 'f', '10/01/2022', '', ['tloc', 'thoai'], [], 'Con 2 trai 4', {})
    ];
  }

  function sampleAnnouncements() {
    const now = Date.now();
    const mk = (id, title, date, content, days) => ({
      id: id, title: title, date: date, content: content,
      photo: null, author: 'Admin', authorName: 'Quản trị viên',
      createdAt: now - days * 86400000
    });
    return [
      mk('ann-sample-1', 'Lễ giỗ tổ Trương Gia', isoInDays(9), 'Toàn thể dòng họ tề tựu tại nhà thờ họ lúc 10 giờ. Các nhánh chuẩn bị hương hoa, trầu quả đầy đủ.', 2),
      mk('ann-sample-2', 'Quỹ tu sửa nhà thờ họ', '', 'Mỗi nhánh đóng góp tùy khả năng, xin gửi về Ban quản trị gia tộc trước ngày 15 để thống nhất danh sách.', 5),
      mk('ann-sample-3', 'Cập nhật danh sách liên lạc đại gia đình', '', 'Mỗi hộ xin gửi số điện thoại, địa chỉ hiện tại về Zalo nhóm Trương Gia Family trước cuối tháng.', 8)
    ];
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ people: people, announcements: announcements }));
    } catch (e) {
      console.warn('Không thể lưu dữ liệu vào bộ nhớ máy:', e);
    }
  }

  function normalizeAll() {
    const ids = new Set(people.map((p) => p.id));
    people.forEach((p) => {
      p.spouses = [...new Set((p.spouses || []).filter((sid) => sid !== p.id && ids.has(sid)))];
      p.parents = [...new Set((p.parents || []).filter((pid) => pid !== p.id && ids.has(pid)))].slice(0, 2);
    });
    people.forEach((p) => {
      p.spouses.forEach((sid) => {
        const s = byId(sid);
        if (s && !s.spouses.includes(p.id)) s.spouses.push(p.id);
      });
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          people = data;
          announcements = [];
          normalizeAll();
          return;
        }
        if (data && Array.isArray(data.people)) {
          people = data.people;
          announcements = Array.isArray(data.announcements) ? data.announcements : [];
          normalizeAll();
          return;
        }
      }
    } catch (e) { /* bỏ qua dữ liệu hỏng */ }
    people = sampleData();
    announcements = sampleAnnouncements();
    normalizeAll();
    persist();
  }

  function syncSpouses(changedId) {
    const p = byId(changedId);
    if (!p) return;
    p.spouses = [...new Set((p.spouses || []).filter((sid) => sid !== p.id && byId(sid)))];
    people.forEach((q) => {
      if (q.id === changedId) return;
      const has = p.spouses.includes(q.id);
      const listed = (q.spouses || []).includes(changedId);
      if (has && !listed) q.spouses.push(changedId);
      if (!has && listed) q.spouses = q.spouses.filter((x) => x !== changedId);
    });
  }

  function hiddenSet() {
    const hidden = new Set();
    collapsed.forEach((cid) => descendantIds(cid).forEach((d) => hidden.add(d)));
    let changed = true;
    while (changed) {
      changed = false;
      people.forEach((p) => {
        if (hidden.has(p.id) || (p.parents || []).length) return;
        const sp = (p.spouses || []).filter((sid) => byId(sid));
        if (sp.length && sp.every((sid) => hidden.has(sid))) {
          hidden.add(p.id);
          changed = true;
        }
      });
    }
    return hidden;
  }

  function computeLayout() {
    const hidden = hiddenSet();
    const positions = new Map();
    const visited = new Set();
    const rowTop = (d) => d * (NODE_H + LEVEL_GAP);

    function build(id, depth) {
      if (visited.has(id)) return null;
      const p = byId(id);
      if (!p) return null;
      visited.add(id);
      const spouseList = (p.spouses || []).map((s) => byId(s))
        .filter((s) => s && !hidden.has(s.id) && !visited.has(s.id));
      spouseList.forEach((s) => visited.add(s.id));
      const unit = [p].concat(spouseList);
      const width = unit.length * NODE_W + (unit.length - 1) * COUPLE_GAP;

      const kidSet = new Set();
      unit.forEach((m) => childrenOf(m.id).forEach((k) => {
        if (!hidden.has(k.id) && !visited.has(k.id)) kidSet.add(k.id);
      }));
      const kids = collapsed.has(id) ? [] : Array.from(kidSet)
        .map((kid) => byId(kid))
        .sort((a, b) => String(a.birth || '').localeCompare(String(b.birth || ''), undefined, { numeric: true }))
        .map((k) => build(k.id, depth + 1))
        .filter(Boolean);

      let kidsW = 0;
      kids.forEach((k, i) => { kidsW += k.w + (i ? SIBLING_GAP : 0); });
      return { id: id, unit: unit, width: width, kids: kids, kidsW: kidsW, w: Math.max(width, kidsW), depth: depth };
    }

    function place(node, left) {
      let centerX;
      if (node.kids.length) {
        let x = node.kidsW >= node.width
          ? left
          : left + (node.width - node.kidsW) / 2;
        node.kids.forEach((k) => {
          place(k, x);
          x += k.w + SIBLING_GAP;
        });
        const cs = node.kids.map((k) => positions.get(k.id).centerX);
        centerX = (cs[0] + cs[cs.length - 1]) / 2;
        const minC = left + node.width / 2;
        const maxC = left + node.w - node.width / 2;
        if (maxC > minC) centerX = Math.max(minC, Math.min(maxC, centerX));
      } else {
        centerX = left + node.w / 2;
      }
      positions.set(node.id, {
        depth: node.depth, centerX: centerX, width: node.width,
        unit: node.unit, top: rowTop(node.depth), left: left, w: node.w
      });
    }

    let rootX = 0;
    function placeRoot(id, depth) {
      const node = build(id, depth);
      if (!node) return;
      place(node, rootX);
      rootX += node.w + SIBLING_GAP * 2;
    }

    people.forEach((p) => {
      if (hidden.has(p.id) || (p.parents || []).length) return;
      const marriedToChild = (p.spouses || []).some((sid) => {
        const s = byId(sid);
        return s && (s.parents || []).length && !hidden.has(s.id);
      });
      if (marriedToChild) return;
      placeRoot(p.id, 0);
    });
    people.forEach((p) => {
      if (!hidden.has(p.id) && !visited.has(p.id)) placeRoot(p.id, 0);
    });
    return positions;
  }

  function render() {
    lastPositions = computeLayout();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    lastPositions.forEach((pos) => {
      pos.unit.forEach((m, i) => {
        const L = pos.centerX - pos.width / 2 + i * (NODE_W + COUPLE_GAP) + (m.dx || 0);
        const T = pos.top + (m.dy || 0);
        minX = Math.min(minX, L);
        maxX = Math.max(maxX, L + NODE_W);
        minY = Math.min(minY, T);
        maxY = Math.max(maxY, T + NODE_H);
      });
    });
    if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }

    const offX = MARGIN - minX, offY = MARGIN - minY;
    const contentW = (maxX - minX) + MARGIN * 2;
    const contentH = (maxY - minY) + MARGIN * 2;
    lastBBox = { x: MARGIN, y: MARGIN, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };

    el.links.setAttribute('width', contentW);
    el.links.setAttribute('height', contentH);
    el.viewport.style.width = contentW + 'px';
    el.viewport.style.height = contentH + 'px';

    lastPositions.forEach((pos) => {
      pos.rx = pos.centerX + offX;
      pos.ry = pos.top + offY;
      pos.left = pos.centerX - pos.width / 2 + offX;
      pos.ox = pos.unit[0].dx || 0;
      pos.oy = pos.unit[0].dy || 0;
    });

    let svg = '';
    lastPositions.forEach((pos, id) => {
      const startX = pos.rx + pos.ox;
      const bottom = pos.ry + pos.oy + NODE_H;
      childrenOf(id).forEach((k) => {
        const kp = lastPositions.get(k.id);
        if (!kp) return;
        const cx = kp.rx + kp.ox, cy = kp.ry + kp.oy;
        const midY = (bottom + cy) / 2;
        svg += '<path d="M ' + startX + ' ' + bottom + ' C ' + startX + ' ' + midY + ', ' + cx + ' ' + midY + ', ' + cx + ' ' + cy + '"></path>';
      });
      for (let i = 0; i < pos.unit.length - 1; i++) {
        const x1 = pos.left + i * (NODE_W + COUPLE_GAP) + (pos.unit[i].dx || 0) + NODE_W;
        const x2 = pos.left + (i + 1) * (NODE_W + COUPLE_GAP) + (pos.unit[i + 1].dx || 0);
        const y1 = pos.ry + (pos.unit[i].dy || 0) + NODE_H / 2;
        const y2 = pos.ry + (pos.unit[i + 1].dy || 0) + NODE_H / 2;
        svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"></line>';
        svg += '<circle cx="' + ((x1 + x2) / 2) + '" cy="' + ((y1 + y2) / 2) + '" r="3.5"></circle>';
      }
    });
    el.links.innerHTML = svg;

    el.cards.innerHTML = '';
    const frag = document.createDocumentFragment();
    lastPositions.forEach((pos, rootId) => {
      pos.unit.forEach((m, i) => {
        const g = GENDER[m.gender] || GENDER.o;
        const card = document.createElement('div');
        card.className = 'card ' + g.cls + (selectedId === m.id ? ' selected' : '');
        card.dataset.id = m.id;
        const bl = pos.left + i * (NODE_W + COUPLE_GAP);
        card.style.left = (bl + (m.dx || 0)) + 'px';
        card.style.top = (pos.ry + (m.dy || 0)) + 'px';
        card.dataset.bx = bl;
        card.dataset.by = pos.ry;
        if (isAdmin()) card.title = 'Kéo để sắp xếp lại vị trí';
        const avatar = m.photo
          ? '<img src="' + esc(m.photo) + '" alt="">'
          : esc((m.name || '?').trim().charAt(0).toUpperCase());
        card.innerHTML =
          '<div class="card-actions admin-only">' +
            '<button class="card-action" data-act="edit" title="Sửa">' + ICONS.pencil + '</button>' +
            '<button class="card-action danger" data-act="del" title="Xóa">' + ICONS.trash + '</button>' +
          '</div>' +
          '<div class="avatar">' + avatar + '</div>' +
          '<div class="info">' +
            '<div class="name">' + esc(m.name) + '</div>' +
            '<div class="years">' + esc(yearsStr(m)) + '</div>' +
          '</div>';
        frag.appendChild(card);
      });
      if (descendantCount(rootId) > 0) {
        const btn = document.createElement('button');
        btn.className = 'collapse-btn';
        btn.dataset.id = rootId;
        btn.textContent = collapsed.has(rootId) ? '+' : '−';
        btn.title = collapsed.has(rootId) ? 'Mở rộng' : 'Thu gọn';
        btn.style.left = (pos.rx + pos.ox - 12) + 'px';
        btn.style.top = (pos.ry + pos.oy + NODE_H - 2) + 'px';
        frag.appendChild(btn);
      }
    });
    el.cards.appendChild(frag);

    updateEmptyState();
    applyTransform();
    updateZoomLabel();
    renderMembers();
    renderHome();
  }

  function updateEmptyState() {
    el.emptyState.classList.toggle('hidden', people.length > 0);
  }

  const ALBUM_ICONS = {
    flame: '<svg viewBox="0 0 24 24"><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-5 0 2 2 3 2 3s0-4 0-6z"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9 9 9M5 10v10h14V10"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 7l2-3h4l2 3"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
  };

  const ALBUM_META = {
    gigoto: {
      title: 'Lễ giỗ tổ',
      desc: 'Những khoảnh khắc tại lễ giỗ tổ họ Trương hằng năm ở nhà thờ họ.'
    },
    hopmat: {
      title: 'Họp mặt',
      desc: 'Những buổi họp mặt, liên hoan của đại gia đình.'
    },
    tet: {
      title: 'Tết cổ truyền',
      desc: 'Không khí Tết cổ truyền của dòng họ.'
    }
  };

  const POSTS_KEY = 'giapha-posts-v1';
  let posts = [];

  function seedPosts() {
    const data = [
      { album: 'gigoto', icon: 'flame', cap: 'Nghi lễ thắp hương', tag: 'Giỗ tổ hằng năm', content: 'Nghi thức thắp hương khai hội được cử hành trang nghiêm đầu buổi lễ. Con cháu lần lượt lên đường hương tưởng nhớ công ơn tổ tiên.' },
      { album: 'gigoto', icon: 'home', cap: 'Nhà thờ họ Trương', tag: 'Làng Văn Gia', content: 'Nhà thờ họ tại làng Văn Gia là nơi sinh hoạt chung của cả dòng họ, nơi thờ tự và tổ chức các dịp lễ lớn trong năm.' },
      { album: 'gigoto', icon: 'calendar', cap: 'Mâm cỗ ngày giỗ', tag: 'Cả dòng họ', content: 'Mâm cỗ cúng ngày giỗ được các nhánh chuẩn bị công phu, vừa giữ nếp truyền thống vừa ấm áp tình làng nghĩa họ.' },
      { album: 'gigoto', icon: 'people', cap: 'Con cháu tề tựu', tag: 'Đông đủ các nhánh', content: 'Giỗ tổ hằng năm có mặt đông đủ con cháu các nhánh, dịp để các thế hệ gặp gỡ, hỏi thăm và gắn kết.' },
      { album: 'gigoto', icon: 'heart', cap: 'Hương khói nhớ nguồn', tag: 'Uống nước nhớ nguồn', content: 'Truyền thống uống nước nhớ nguồn được gìn giữ qua bao thế hệ — mỗi nén hương là một lời tri ân tổ tiên.' },
      { album: 'gigoto', icon: 'camera', cap: 'Ảnh lưu niệm', tag: 'Kỷ niệm cùng nhau', content: 'Cuối buổi lễ, cả họ chụp ảnh lưu niệm bên nhà thờ, lưu giữ khoảnh khắc sum vầy.' },
      { album: 'hopmat', icon: 'people', cap: 'Họp mặt cuối năm', tag: 'Cả đại gia đình', content: 'Buổi họp mặt cuối năm tổng kết hoạt động của họ, thống nhất kế hoạch năm mới và cùng nhau dùng bữa tối ấm cúng.' },
      { album: 'hopmat', icon: 'calendar', cap: 'Liên hoan ngày hè', tag: 'Cuối tháng 6', content: 'Liên hoan ngày hè dành cho con cháu ở xa trở về, giao lưu văn nghệ và kể chuyện tổ tiên.' },
      { album: 'hopmat', icon: 'camera', cap: 'Chuyện trò bên bánh', tag: 'Kỷ niệm', content: 'Trà, bánh và những câu chuyện ngày xưa — các cụ kể, con cháu nghe, cả nhà cùng cười vang.' },
      { album: 'hopmat', icon: 'home', cap: 'Về thăm quê cũ', tag: 'Làng Văn Gia', content: 'Đoàn con cháu về thăm quê cũ, ra đồng, lên lúa, thăm lại nơi tổ tiên đã sinh sống.' },
      { album: 'hopmat', icon: 'heart', cap: 'Gặp gỡ anh em', tag: 'Gắn kết họ tộc', content: 'Dịp gặp gỡ hiếm hoi của anh em trong họ, hẹn hò nhau giúp đỡ việc lớn nhỏ của các gia đình.' },
      { album: 'hopmat', icon: 'music', cap: 'Tiệc mừng thọ', tag: 'Các cụ cao tuổi', content: 'Cả họ tổ chức tiệc mừng thọ cho các cụ cao tuổi, chúc sức khỏe, sống lâu trăm tuổi.' },
      { album: 'tet', icon: 'heart', cap: 'Gói bánh chưng', tag: 'Ngày 29 Tết', content: 'Chiều 29 Tết cả nhà họ quây quần gói bánh chưng, nồi bánh luộc đỏ lửa chờ giao thừa.' },
      { album: 'tet', icon: 'flame', cap: 'Lễ cúng giao thừa', tag: 'Đêm 30 Tết', content: 'Lễ cúng giao thừa tại nhà thờ họ, cả dòng họ hương khói nghiêm trang đón thời khắc chuyển năm.' },
      { album: 'tet', icon: 'people', cap: 'Chúc Tết ông bà', tag: 'Mùng 1 - Mùng 3', content: 'Con cháu lần lượt về chúc Tết ông bà, lì xì đầu năm, mong năm mới sức khỏe và may mắn.' },
      { album: 'tet', icon: 'music', cap: 'Hội xuân làng', tag: 'Mùng 5 Tết', content: 'Hội xuân làng với trò chơi dân gian, cờ người, chèo đò — con cháu trong họ tham gia đông vui.' },
      { album: 'tet', icon: 'camera', cap: 'Cây quất, câu đối', tag: 'Trang trí nhà', content: 'Nhà thờ họ được trang trí cây quất vàng, câu đối đỏ rực chào đón năm mới.' },
      { album: 'tet', icon: 'home', cap: 'Xông đất đầu năm', tag: 'Mùng 1 Tết', content: 'Theo lệ, người xông đất đầu năm là thành viên đáng quý trong họ — năm nào cũng chọn kỹ càng.' }
    ];
    const base = Date.now() - data.length * 60000;
    return data.map((d, i) => ({
      id: uid(),
      album: d.album,
      icon: d.icon,
      cap: d.cap,
      tag: d.tag,
      content: d.content,
      photo: null,
      author: 'admin',
      authorName: 'Ban quản trị',
      createdAt: base + i * 60000,
      updatedAt: null,
      comments: []
    }));
  }

  function persistPosts() {
    try {
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    } catch (e) { /* bỏ qua */ }
  }

  function loadPosts() {
    try {
      const raw = localStorage.getItem(POSTS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          posts = arr;
          posts.forEach((p) => { if (!Array.isArray(p.comments)) p.comments = []; });
          return;
        }
      }
    } catch (e) { /* bỏ qua */ }
    posts = seedPosts();
    persistPosts();
  }

  function postById(id) { return posts.find((p) => p.id === id) || null; }

  function canEditPost(p) {
    return isAdmin() || (!!currentUser && !!p && p.author === currentUser.username);
  }

  let lastAlbumView = null;

  function renderAlbum(id) {
    lastAlbumView = id;
    const content = $('albumContent');
    const meta = ALBUM_META[id];
    if (!meta) {
      content.innerHTML = '<h2>Không tìm thấy trang</h2>';
      return;
    }
    const list = posts.filter((p) => p.album === id);
    const card = (p, i) => {
      const editable = canEditPost(p);
      const visual = p.photo
        ? '<img class="a-photo" src="' + esc(p.photo) + '" alt="">'
        : ALBUM_ICONS[p.icon] || ALBUM_ICONS.camera;
      return '<div class="album-card tile-' + ((i % 6) + 1) + (p.photo ? ' has-photo' : '') + '" data-post="' + p.id + '">' +
        visual +
        '<div class="a-cap">' + esc(p.cap) + '</div>' +
        '<div class="a-date">' + esc(p.tag || '') + '</div>' +
        '<div class="a-comments">' + ICONS.comment + ' ' + p.comments.length + '</div>' +
        (editable
          ? '<div class="album-actions">' +
              '<button class="card-action" data-pact="edit" title="Sửa bài">' + ICONS.pencil + '</button>' +
              '<button class="card-action danger" data-pact="del" title="Xóa bài">' + ICONS.trash + '</button>' +
            '</div>'
          : '') +
      '</div>';
    };
    const writeBtn = canPost()
      ? '<div class="album-toolbar"><button class="btn primary" id="btnNewPost">' + ICONS.plus + ' Viết bài mới</button></div>'
      : '';
    content.innerHTML =
      '<h2>' + esc(meta.title) + '</h2>' +
      '<div class="album-desc">' + esc(meta.desc) + '</div>' +
      writeBtn +
      (list.length
        ? '<div class="album-grid">' + list.map(card).join('') + '</div>'
        : '<div class="album-note">Chưa có bài viết nào trong mục này.</div>');
    const btnNew = $('btnNewPost');
    if (btnNew) btnNew.addEventListener('click', () => openPostEditor(id));
  }

  function fmtDateTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  let openPostId = null;
  let editingPostId = null;
  let editingPostAlbum = null;
  let postPhotoData = null;

  function openPostDetail(id) {
    const p = postById(id);
    if (!p) return;
    openPostId = id;
    renderPostDetail();
    $('postOverlay').classList.remove('hidden');
  }

  function closePostDetail() {
    openPostId = null;
    $('postOverlay').classList.add('hidden');
  }

  function renderPostDetail() {
    const p = postById(openPostId);
    if (!p) return closePostDetail();
    $('postOvTitle').textContent = p.cap;
    const meta = ALBUM_META[p.album];
    $('postOvBody').innerHTML =
      '<div class="p-meta">' +
        (meta ? esc(meta.title) + ' · ' : '') +
        'Đăng bởi <b>' + esc(p.authorName || 'Ẩn danh') + '</b>' +
        (p.createdAt ? ' · ' + fmtDateTime(p.createdAt) : '') +
        (p.updatedAt ? ' · đã sửa ' + fmtDateTime(p.updatedAt) : '') +
      '</div>' +
      (p.tag ? '<div class="p-tag">' + esc(p.tag) + '</div>' : '') +
      (p.photo ? '<img class="p-photo" src="' + esc(p.photo) + '" alt="">' : '') +
      (p.content ? '<p class="p-content">' + esc(p.content) + '</p>' : '<p class="p-content muted">Chưa có nội dung.</p>') +
      (canEditPost(p)
        ? '<div class="p-tools">' +
            '<button class="btn sm" id="btnEditPost">' + ICONS.pencil + ' Sửa bài</button>' +
            '<button class="btn sm danger" id="btnDelPost">' + ICONS.trash + ' Xóa bài</button>' +
          '</div>'
        : '');
    $('btnEditPost').addEventListener('click', () => openPostEditor(p.album, p.id));
    $('btnDelPost').addEventListener('click', () => deletePost(p.id));
    renderPostComments(p);
  }

  function renderPostComments(p) {
    const wrap = $('postOvComments');
    const items = p.comments.length
      ? p.comments.map((c) => {
          const deletable = (currentUser && c.user === currentUser.username) || isAdmin();
          return '<div class="comment">' +
            '<div class="c-av">' + esc((c.name || '?').charAt(0).toUpperCase()) + '</div>' +
            '<div class="c-main">' +
              '<div class="c-head"><b>' + esc(c.name || c.user) + '</b><span>' + fmtDateTime(c.createdAt) + '</span>' +
                (deletable ? '<button class="c-del" data-cid="' + c.id + '" title="Xóa bình luận">' + ICONS.trash + '</button>' : '') +
              '</div>' +
              '<div class="c-text">' + esc(c.text) + '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="c-empty">Chưa có bình luận nào.</div>';
    wrap.innerHTML =
      '<h4>Bình luận (' + p.comments.length + ')</h4>' +
      '<div class="comments-list">' + items + '</div>' +
      '<form id="commentForm" class="comment-form">' +
        '<input id="commentText" type="text" placeholder="Viết bình luận..." autocomplete="off" maxlength="500">' +
        '<button type="submit" class="btn sm primary">Gửi</button>' +
      '</form>';
    $('commentForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('commentText');
      const text = input.value.trim();
      if (!text || !currentUser) return;
      p.comments.push({
        id: uid(),
        user: currentUser.username,
        name: currentUser.name || currentUser.username,
        text: text,
        createdAt: Date.now()
      });
      persistPosts();
      renderPostComments(p);
      if (lastAlbumView) renderAlbum(lastAlbumView);
    });
    wrap.querySelectorAll('.c-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!window.confirm('Xóa bình luận này?')) return;
        p.comments = p.comments.filter((x) => x.id !== btn.dataset.cid);
        persistPosts();
        renderPostComments(p);
        if (lastAlbumView) renderAlbum(lastAlbumView);
      });
    });
  }

  function deletePost(id) {
    const p = postById(id);
    if (!p) return;
    if (!window.confirm('Xóa bài viết "' + p.cap + '"?')) return;
    posts = posts.filter((x) => x.id !== id);
    persistPosts();
    if (openPostId === id) closePostDetail();
    if (lastAlbumView) renderAlbum(lastAlbumView);
  }

  function openPostEditor(albumId, id) {
    editingPostAlbum = albumId;
    editingPostId = id || null;
    const p = id ? postById(id) : null;
    if (id && !p) return;
    $('postEdTitle').textContent = p ? 'Sửa bài viết' : 'Viết bài mới';
    $('btnSavePost').textContent = p ? 'Lưu thay đổi' : 'Đăng bài viết';
    $('pCap').value = p ? p.cap : '';
    $('pTag').value = p ? (p.tag || '') : '';
    $('pContent').value = p ? (p.content || '') : '';
    postPhotoData = p ? p.photo : null;
    updatePostPhotoPreview();
    $('postEditor').classList.remove('hidden');
    window.setTimeout(() => $('pCap').focus(), 50);
  }

  function closePostEditor() {
    editingPostId = null;
    editingPostAlbum = null;
    postPhotoData = null;
    $('postEditor').classList.add('hidden');
  }

  function updatePostPhotoPreview() {
    $('postPhotoPreview').innerHTML = postPhotoData
      ? '<img src="' + esc(postPhotoData) + '" alt=""><button type="button" class="icon-btn" id="btnRemovePostPhoto" title="Xóa ảnh">' + ICONS.trash + '</button>'
      : '';
    const rm = $('btnRemovePostPhoto');
    if (rm) rm.addEventListener('click', () => {
      postPhotoData = null;
      updatePostPhotoPreview();
    });
  }

  function savePost(e) {
    e.preventDefault();
    const cap = $('pCap').value.trim();
    if (!cap) {
      $('pCap').classList.add('invalid');
      $('pCap').focus();
      return;
    }
    $('pCap').classList.remove('invalid');
    const now = Date.now();
    if (editingPostId) {
      const p = postById(editingPostId);
      if (p) {
        p.cap = cap;
        p.tag = $('pTag').value.trim();
        p.content = $('pContent').value.trim();
        p.photo = postPhotoData;
        p.updatedAt = now;
      }
    } else {
      posts.push({
        id: uid(),
        album: editingPostAlbum,
        icon: 'camera',
        cap: cap,
        tag: $('pTag').value.trim(),
        content: $('pContent').value.trim(),
        photo: postPhotoData,
        author: currentUser.username,
        authorName: currentUser.name || currentUser.username,
        createdAt: now,
        updatedAt: null,
        comments: []
      });
    }
    persistPosts();
    closePostEditor();
    if (lastAlbumView) renderAlbum(lastAlbumView);
    if (openPostId) renderPostDetail();
  }

  function showView(name) {
    const albumId = name.indexOf('album:') === 0 ? name.slice(6) : null;
    el.canvas.classList.toggle('hidden', name !== 'tree');
    $('viewHome').classList.toggle('hidden', name !== 'home');
    $('viewMembers').classList.toggle('hidden', name !== 'members');
    $('viewMonth').classList.toggle('hidden', name !== 'month');
    $('viewContact').classList.toggle('hidden', name !== 'contact');
    $('viewAlbum').classList.toggle('hidden', !albumId);
    document.body.classList.toggle('tree-fs', name === 'tree');
    document.querySelectorAll('.mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
    if (albumId) renderAlbum(albumId);
    if (name === 'month') renderMonthBoard();
    if (name === 'contact') renderContact();
    if (name === 'tree') fitView();
  }

  function tickClock() {
    const d = new Date();
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const clock = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const date = days[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    const c = $('datetime');
    if (c) c.textContent = clock + ' ICT · ' + date;
  }

  function nextOccurrences(limit) {
    const arr = [];
    people.forEach((p) => {
      const b = parseDate(p.birth);
      if (b && b.mo && b.d && !isDeceased(p)) {
        const o = nextOccurrence(b.mo, b.d);
        arr.push({ kind: 'birthday', person: p, days: o.days, date: o.date, y: b.y });
      }
      const dd = parseDate(p.death);
      if (dd && dd.mo && dd.d) {
        const o = nextOccurrence(dd.mo, dd.d);
        arr.push({ kind: 'memorial', person: p, days: o.days, date: o.date, y: dd.y });
      }
    });
    return arr.sort((a, b) => a.days - b.days).slice(0, limit);
  }

  function renderHome() {
    const feat = announcements[0];
    $('homeFeatured').innerHTML = feat
      ? '<h2>' + esc(feat.title) + '</h2>' +
        '<div class="f-meta">' + (feat.date ? 'Ngày ' + esc(formatDateVN(feat.date)) : 'Thông báo mới') + (feat.authorName ? ' · ' + esc(feat.authorName) : '') + '</div>' +
        (feat.photo ? '<img class="f-photo" src="' + esc(feat.photo) + '" alt="">' : '') +
        (feat.content ? '<p>' + esc(feat.content) + '</p>' : '')
      : '<h2>Chào mừng đến với Trương Gia Việt Nam</h2>' +
        '<p>Nơi lưu giữ gia phả, thê hệ và những tin tức của dòng họ họ Trương. Quản trị viên đăng nhập để cập nhật nội dung.</p>';
    const annItem = (a) => '<li data-goto="month"><span>' + esc(a.title) + '</span><span class="n-date">' + (a.date ? esc(formatDateVN(a.date)) : '') + '</span></li>';
    $('homeAnnouncements').innerHTML = announcements.length
      ? announcements.slice(0, 6).map(annItem).join('')
      : '<li class="empty"><span>Chưa có thông báo nào.</span></li>';
    $('homeRecent').innerHTML = announcements.length
      ? announcements.slice(0, 5).map(annItem).join('')
      : '<li class="empty"><span>Chưa có bài đăng nào.</span></li>';
    const evts = upcomingEvents();
    $('homeEvents').innerHTML = evts.length
      ? evts.slice(0, 6).map((e) =>
          '<li data-person="' + e.person.id + '"><span>' +
          (e.type === 'birthday' ? 'Sinh nhật ' : 'Ngày giỗ ') + esc(e.person.name) +
          '</span><span class="n-date">' + (e.days === 0 ? 'Hôm nay' : 'còn ' + e.days + ' ngày') + '</span></li>'
        ).join('')
      : '<li class="empty"><span>Không có sự kiện nào trong 30 ngày tới.</span></li>';
    const nexts = nextOccurrences(10);
    const evItem = (e) =>
      '<li data-person="' + e.person.id + '"><span>' +
      esc(e.person.name) +
      '</span><span class="n-date">' + (e.days === 0 ? 'Hôm nay' : e.date.getDate() + '/' + (e.date.getMonth() + 1)) + '</span></li>';
    const bdays = nexts.filter((e) => e.kind === 'birthday');
    const memos = nexts.filter((e) => e.kind === 'memorial');
    $('homeBirthday').innerHTML = bdays.length
      ? bdays.map(evItem).join('')
      : '<li class="empty"><span>Chưa có dữ liệu sinh nhật.</span></li>';
    $('homeMemorial').innerHTML = memos.length
      ? memos.map(evItem).join('')
      : '<li class="empty"><span>Chưa có dữ liệu ngày giỗ.</span></li>';
    const male = people.filter((p) => p.gender === 'm').length;
    const female = people.filter((p) => p.gender === 'f').length;
    const passed = people.filter((p) => parseYear(p.death)).length;
    $('homeStats').innerHTML =
      '<div class="stat"><b>' + people.length + '</b><span>thành viên</span></div>' +
      '<div class="stat"><b>' + male + ' / ' + female + '</b><span>nam / nữ</span></div>' +
      '<div class="stat"><b>' + passed + '</b><span>đã mất</span></div>';
  }

  function renderContact() {
    const dir = people
      .filter((p) => p.phone || p.email)
      .map((p) => {
        const g = GENDER[p.gender] || GENDER.o;
        const avatar = p.photo
          ? '<img src="' + esc(p.photo) + '" alt="">'
          : esc((p.name || '?').charAt(0).toUpperCase());
        return '<div class="member-card ' + g.cls + '" data-id="' + p.id + '">' +
          '<div class="m-avatar ' + g.cls + '">' + avatar + '</div>' +
          '<div class="m-main">' +
            '<div class="m-name">' + esc(p.name) + '</div>' +
            '<div class="m-years">' + esc(p.job || yearsStr(p) || '') + '</div>' +
            (p.phone ? '<a class="m-contact" href="tel:' + esc(p.phone.replace(/\s+/g, '')) + '">' + esc(p.phone) + '</a>' : '') +
            (p.email ? '<a class="m-contact" href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    $('contactDirectory').innerHTML = dir || '<div class="bell-empty">Chưa có thông tin liên hệ nào.</div>';
    $('contactDirectory').querySelectorAll('.member-card').forEach((c) => {
      c.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        showView('tree');
        select(c.dataset.id);
        focusPerson(c.dataset.id);
      });
    });
  }

  function renderMembers() {
    const grid = $('membersGrid');
    if (!grid) return;
    const sorted = [...people].sort((a, b) =>
      String(a.birth || '9999').localeCompare(String(b.birth || '9999'), undefined, { numeric: true }));
    grid.innerHTML = sorted.map((p) => {
      const g = GENDER[p.gender] || GENDER.o;
      const avatar = p.photo
        ? '<img src="' + esc(p.photo) + '" alt="">'
        : esc((p.name || '?').trim().charAt(0).toUpperCase());
      const meta = [p.job, p.hometown].filter(Boolean).map(esc).join(' · ');
      return '<div class="member-card ' + g.cls + '" data-id="' + p.id + '">' +
        '<div class="m-avatar ' + g.cls + '">' + avatar + '</div>' +
        '<div class="m-main">' +
          '<div class="m-name">' + esc(p.name) + '</div>' +
          '<div class="m-years">' + esc(yearsStr(p) || '—') + '</div>' +
          (meta ? '<div class="m-meta">' + meta + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    grid.querySelectorAll('.member-card').forEach((c) => {
      c.addEventListener('click', () => {
        showView('tree');
        select(c.dataset.id);
        focusPerson(c.dataset.id);
      });
    });
  }

  function monthEvents() {
    const now = new Date();
    const mo = now.getMonth() + 1;
    const nextMo = mo === 12 ? 1 : mo + 1;
    const list = { thisMonth: [], nextMonth: [] };
    people.forEach((p) => {
      const b = parseDate(p.birth);
      if (b && b.mo && b.d && !isDeceased(p)) {
        if (b.mo === mo) list.thisMonth.push({ kind: 'birthday', person: p, day: b.d, y: b.y });
        else if (b.mo === nextMo) list.nextMonth.push({ kind: 'birthday', person: p, day: b.d, y: b.y });
      }
      const dd = parseDate(p.death);
      if (dd && dd.mo && dd.d) {
        if (dd.mo === mo) list.thisMonth.push({ kind: 'memorial', person: p, day: dd.d, y: dd.y });
        else if (dd.mo === nextMo) list.nextMonth.push({ kind: 'memorial', person: p, day: dd.d, y: dd.y });
      }
    });
    list.thisMonth.sort((a, b) => a.day - b.day);
    list.nextMonth.sort((a, b) => a.day - b.day);
    return list;
  }

  function eventItemHtml(e, now) {
    const g = GENDER[e.person.gender] || GENDER.o;
    const todayD = now.getDate();
    let when;
    if (e.scope === 'this') {
      when = e.day >= todayD
        ? (e.day === todayD ? 'Hôm nay!' : (e.day - todayD === 1 ? 'Ngày mai' : 'còn ' + (e.day - todayD) + ' ngày'))
        : 'Đã diễn ra';
    } else {
      const o = nextOccurrence(e.mo, e.day);
      when = o.days === 0 ? 'Hôm nay!' : 'còn ' + o.days + ' ngày';
    }
    const title = e.kind === 'birthday'
      ? 'Sinh nhật ' + esc(e.person.name) + (e.y ? ' (tròn ' + (now.getFullYear() - e.y) + ' tuổi)' : '')
      : 'Ngày giỗ của ' + esc(e.person.name) + (e.y ? ' (tròn ' + (now.getFullYear() - e.y) + ' năm)' : '');
    const avatar = e.person.photo
      ? '<img src="' + esc(e.person.photo) + '" alt="">'
      : esc((e.person.name || '?').charAt(0).toUpperCase());
    return '<div class="mb-item clickable' + (e.day === todayD && e.scope === 'this' ? ' today' : '') + '" data-person="' + e.person.id + '">' +
      '<div class="mb-day"><b>' + e.day + '</b><span>/' + e.mo + '</span></div>' +
      '<div class="bi-avatar ' + g.cls + '">' + avatar + '</div>' +
      '<div class="bi-main"><div class="bi-title">' + title + '</div>' +
      '<div class="bi-sub">' + when + '</div></div>' +
    '</div>';
  }

  function renderMonthBoard() {
    const now = new Date();
    const mo = now.getMonth() + 1;
    const nextMo = mo === 12 ? 1 : mo + 1;
    const evts = monthEvents();
    const thisEvents = evts.thisMonth.map((e) => { e.scope = 'this'; e.mo = mo; return e; });
    const nextEvents = evts.nextMonth.map((e) => { e.scope = 'next'; e.mo = nextMo; return e; });
    const bday = (arr) => arr.filter((e) => e.kind === 'birthday');
    const memo = (arr) => arr.filter((e) => e.kind === 'memorial');
    const block = (title, arr, emptyMsg) =>
      '<div class="mb-block"><h3>' + title + '</h3>' +
      (arr.length ? arr.map((e) => eventItemHtml(e, now)).join('') : '<div class="bell-empty">' + emptyMsg + '</div>') +
      '</div>';
    const monthNames = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    $('monthTitle').textContent = 'Thông báo tháng ' + mo + '/' + now.getFullYear();
    const inMonth = (a) => {
      if (!a.date) return false;
      const dt = parseDate(a.date);
      return dt && dt.mo === mo && dt.y === now.getFullYear();
    };
    const annItems = announcements.map((a) => {
      const ctl = ownsAnn(a)
        ? '<button class="icon-btn ann-edit" data-id="' + a.id + '" title="Sửa">' + ICONS.pencil + '</button>' +
          '<button class="icon-btn bi-del" data-id="' + a.id + '" title="Xóa thông báo">' + ICONS.close + '</button>'
        : '';
      return '<div class="mb-item">' +
        '<div class="mb-ann-date">' + (a.date ? esc(formatDateVN(a.date)) : '—') + (inMonth(a) ? '<span class="mb-chip">Tháng này</span>' : '') + '</div>' +
        (a.photo ? '<img class="ann-photo" src="' + esc(a.photo) + '" alt="">' : '') +
        '<div class="bi-main">' +
          '<div class="bi-title">' + esc(a.title) + '</div>' +
          '<div class="bi-sub">' + esc(a.authorName || a.author || 'Ban quản trị') + '</div>' +
          (a.content ? '<div class="bi-content">' + esc(a.content) + '</div>' : '') +
        '</div>' + ctl +
      '</div>';
    }).join('');
    $('monthBoard').innerHTML =
      block('Sinh nhật tháng ' + mo, bday(thisEvents), 'Không có sinh nhật nào trong tháng này.') +
      block('Ngày giỗ tháng ' + mo, memo(thisEvents), 'Không có ngày giỗ nào trong tháng này.') +
      block('Sắp tới tháng ' + nextMo, thisEvents.concat(nextEvents).filter((e) => e.scope === 'next'), 'Không có sự kiện nào trong tháng tới.') +
      '<div class="mb-block"><h3>Thông báo gia tộc <button class="btn sm primary post-only" id="btnAddAnnounceMonth">' + ICONS.plus + ' Đăng thông báo</button></h3>' +
      (announcements.length ? annItems : '<div class="bell-empty">Chưa có thông báo nào.</div>') +
      '</div>';
    $('btnAddAnnounceMonth').addEventListener('click', openAnnounceModal);
    $('monthBoard').querySelectorAll('.ann-edit').forEach((b) => {
      b.addEventListener('click', () => openAnnounceModal({ edit: b.dataset.id }));
    });
    $('monthBoard').querySelectorAll('.bi-del').forEach((b) => {
      b.addEventListener('click', () => deleteAnnouncement(b.dataset.id));
    });
    $('monthBoard').querySelectorAll('.mb-item.clickable').forEach((it) => {
      it.addEventListener('click', () => {
        showView('tree');
        select(it.dataset.person);
        focusPerson(it.dataset.person);
      });
    });
  }

  function applyTransform() {
    el.viewport.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')';
  }

  function updateZoomLabel() {
    el.zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  }

  function zoomAt(cx, cy, factor) {
    const ns = Math.min(2.5, Math.max(0.15, view.scale * factor));
    factor = ns / view.scale;
    view.x = cx - (cx - view.x) * factor;
    view.y = cy - (cy - view.y) * factor;
    view.scale = ns;
    applyTransform();
    updateZoomLabel();
  }

  function fitView() {
    const r = el.canvas.getBoundingClientRect();
    const pad = 60;
    const s = Math.min((r.width - pad * 2) / lastBBox.w, (r.height - pad * 2) / lastBBox.h, 1.2);
    view.scale = Math.max(0.15, isFinite(s) && s > 0 ? s : 1);
    view.x = (r.width - lastBBox.w * view.scale) / 2 - lastBBox.x * view.scale;
    view.y = (r.height - lastBBox.h * view.scale) / 2 - lastBBox.y * view.scale;
    applyTransform();
    updateZoomLabel();
  }

  function focusPerson(id) {
    const pos = lastPositions.get(id);
    if (!pos) return;
    const i = pos.unit.findIndex((m) => m.id === id);
    const idx = i >= 0 ? i : 0;
    const cx = pos.left + idx * (NODE_W + COUPLE_GAP) + (pos.unit[idx].dx || 0) + NODE_W / 2;
    const cy = pos.ry + (pos.unit[idx].dy || 0) + NODE_H / 2;
    const r = el.canvas.getBoundingClientRect();
    view.x = r.width / 2 - cx * view.scale;
    view.y = r.height / 2 - cy * view.scale;
    applyTransform();
  }

  function select(id) {
    selectedId = id;
    document.querySelectorAll('.card').forEach((c) => {
      c.classList.toggle('selected', c.dataset.id === id);
    });
    if (id) showDetails(id); else hideDetails();
  }

  function hideDetails() {
    el.details.classList.add('hidden');
  }

  function showDetails(id) {
    const p = byId(id);
    if (!p) return hideDetails();
    const g = GENDER[p.gender] || GENDER.o;
    const rel = (ids) => (ids || []).map(byId).filter(Boolean);
    const linkList = (arr) => arr.length
      ? '<div class="d-links">' + arr.map((q) => '<span class="d-link" data-id="' + q.id + '">' + esc(q.name) + '</span>').join('') + '</div>'
      : '<div class="d-none">—</div>';
    const parents = rel(p.parents);
    const spouses = rel(p.spouses);
    const kids = childrenOf(id);
    const rowHtml = (label, value) =>
      '<div class="d-row"><span>' + label + '</span><b>' + esc(value) + '</b></div>';
    const infoRows =
      (p.hometown ? rowHtml('Quê quán', p.hometown) : '') +
      (p.job ? rowHtml('Nghề nghiệp', p.job) : '') +
      (p.address ? rowHtml('Địa chỉ', p.address) : '');
    const contactRows =
      (p.phone ? '<a class="d-row link" href="tel:' + esc(p.phone.replace(/\s+/g, '')) + '"><span>Điện thoại</span><b>' + esc(p.phone) + '</b></a>' : '') +
      (p.email ? '<a class="d-row link" href="mailto:' + esc(p.email) + '"><span>Email</span><b>' + esc(p.email) + '</b></a>' : '');
    const dateRows =
      (parseDate(p.birth) && parseDate(p.birth).d ? rowHtml('Ngày sinh', formatDateVN(p.birth)) : '') +
      (parseDate(p.death) && parseDate(p.death).d ? rowHtml('Ngày mất', formatDateVN(p.death)) : '');
    const chips = upcomingEvents()
      .filter((e) => e.person.id === id)
      .map((e) => '<div class="d-chip' + (e.days === 0 ? ' today' : '') + '">' +
        (e.type === 'birthday' ? 'Sinh nhật' : 'Ngày giỗ') +
        (e.days === 0 ? ' hôm nay!' : ' còn ' + e.days + ' ngày') + '</div>')
      .join('');
    el.details.innerHTML =
      '<button class="icon-btn d-close" id="dClose">' + ICONS.close + '</button>' +
      '<div class="d-head">' +
        '<div class="d-avatar ' + g.cls + '">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">' : esc((p.name || '?').charAt(0).toUpperCase())) + '</div>' +
        '<div><h2>' + esc(p.name) + '</h2><div class="d-sub">' + g.label + (yearsStr(p) ? ' · ' + esc(yearsStr(p)) : '') + '</div></div>' +
      '</div>' +
      chips +
      (p.note ? '<p class="d-note">' + esc(p.note) + '</p>' : '') +
      '<div class="d-actions admin-only">' +
        '<button id="dEdit" class="btn sm primary">' + ICONS.pencil + ' Sửa</button>' +
        '<button id="dAddChild" class="btn sm">' + ICONS.plus + ' Thêm con</button>' +
        '<button id="dAddSpouse" class="btn sm">' + ICONS.plus + ' Thêm vợ/chồng</button>' +
        '<button id="dDelete" class="btn sm danger">' + ICONS.trash + ' Xóa</button>' +
      '</div>' +
      ((infoRows || dateRows) ? '<div class="d-section"><h4>Hồ sơ</h4>' + dateRows + infoRows + '</div>' : '') +
      (contactRows ? '<div class="d-section"><h4>Liên hệ</h4>' + contactRows + '</div>' : '') +
      '<div class="d-section"><h4>Cha / Mẹ</h4>' + linkList(parents) + '</div>' +
      '<div class="d-section"><h4>Vợ / Chồng</h4>' + linkList(spouses) + '</div>' +
      '<div class="d-section"><h4>Con (' + kids.length + ')</h4>' + linkList(kids) + '</div>';

    $('dClose').addEventListener('click', () => select(null));
    $('dEdit').addEventListener('click', () => openModal({ mode: 'edit', id: id }));
    $('dAddChild').addEventListener('click', () => {
      openModal({
        mode: 'add',
        presetFather: g.cls !== 'female' ? id : '',
        presetMother: g.cls === 'female' ? id : ''
      });
    });
    $('dAddSpouse').addEventListener('click', () => openModal({ mode: 'add', presetSpouses: [id] }));
    $('dDelete').addEventListener('click', () => deletePerson(id));
    el.details.querySelectorAll('.d-link').forEach((sp) => {
      sp.addEventListener('click', () => {
        select(sp.dataset.id);
        focusPerson(sp.dataset.id);
      });
    });
    el.details.classList.remove('hidden');
  }

  function renderNotifications() {
    const evts = upcomingEvents();
    const annHtml = announcements.length
      ? announcements.map((a) => {
          const ctl = ownsAnn(a)
            ? '<button class="icon-btn" data-act="edit-ann" data-id="' + a.id + '" title="Sửa">' + ICONS.pencil + '</button>' +
              '<button class="icon-btn bi-del" data-id="' + a.id + '" title="Xóa thông báo">' + ICONS.close + '</button>'
            : '';
          return '<div class="bell-item">' +
            (a.photo ? '<img class="ann-photo" src="' + esc(a.photo) + '" alt="">' : '') +
            '<div class="bi-main">' +
              '<div class="bi-title">' + esc(a.title) + '</div>' +
              '<div class="bi-sub">' + esc(a.authorName || a.author || 'Ban quản trị') + (a.date ? ' · ' + esc(formatDateVN(a.date)) : '') + '</div>' +
              (a.content ? '<div class="bi-content">' + esc(a.content) + '</div>' : '') +
            '</div>' + ctl +
          '</div>';
        }).join('')
      : '<div class="bell-empty">Chưa có thông báo nào.</div>';
    const evtHtml = evts.length
      ? evts.map((e) => {
          const g = GENDER[e.person.gender] || GENDER.o;
          const when = e.days === 0 ? 'Hôm nay!' : (e.days === 1 ? 'Ngày mai' : 'còn ' + e.days + ' ngày');
          const label = e.type === 'birthday'
            ? 'Sinh nhật ' + esc(e.person.name) + (e.age != null ? ' (tròn ' + e.age + ' tuổi)' : '')
            : 'Ngày giỗ của ' + esc(e.person.name);
          return '<div class="bell-item clickable" data-person="' + e.person.id + '">' +
            '<div class="bi-avatar ' + g.cls + '">' + (e.person.photo ? '<img src="' + esc(e.person.photo) + '" alt="">' : esc((e.person.name || '?').charAt(0).toUpperCase())) + '</div>' +
            '<div class="bi-main"><div class="bi-title">' + label + '</div>' +
            '<div class="bi-sub">' + when + ' · ' + (e.date.getDate() < 10 ? '0' + e.date.getDate() : e.date.getDate()) + '/' + (e.date.getMonth() + 1 < 10 ? '0' + (e.date.getMonth() + 1) : e.date.getMonth() + 1) + '</div></div>' +
          '</div>';
        }).join('')
      : '<div class="bell-empty">Không có sự kiện nào trong 30 ngày tới.</div>';
    const male = people.filter((p) => p.gender === 'm').length;
    const female = people.filter((p) => p.gender === 'f').length;
    const passed = people.filter((p) => parseYear(p.death)).length;
    el.bellPanel.innerHTML =
      '<div class="bell-head"><span>Thông báo</span><button class="btn sm primary post-only" id="btnAddAnnounce">' + ICONS.plus + ' Thêm thông báo</button></div>' +
      '<div class="bell-section"><h4>Gia tộc</h4>' + annHtml + '</div>' +
      '<div class="bell-section"><h4>Sự kiện sắp tới (30 ngày)</h4>' + evtHtml + '</div>' +
      '<div class="bell-stats">' +
        '<div class="stat"><b>' + people.length + '</b><span>thành viên</span></div>' +
        '<div class="stat"><b>' + male + ' / ' + female + '</b><span>nam / nữ</span></div>' +
        '<div class="stat"><b>' + passed + '</b><span>đã mất</span></div>' +
      '</div>';
    $('btnAddAnnounce').addEventListener('click', () => {
      closeBell();
      openAnnounceModal();
    });
    el.bellPanel.querySelectorAll('[data-act="edit-ann"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openAnnounceModal({ edit: b.dataset.id });
      });
    });
    el.bellPanel.querySelectorAll('.bi-del').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAnnouncement(b.dataset.id);
      });
    });
    el.bellPanel.querySelectorAll('.bell-item.clickable').forEach((it) => {
      it.addEventListener('click', () => {
        closeBell();
        select(it.dataset.person);
        focusPerson(it.dataset.person);
      });
    });
  }

  function updateBellBadge() {
    const n = announcements.length + upcomingEvents().length;
    el.bellBadge.textContent = n > 99 ? '99+' : String(n);
    el.bellBadge.classList.toggle('hidden', n === 0);
  }

  function openBell() {
    renderNotifications();
    el.bellPanel.classList.remove('hidden');
  }

  function closeBell() {
    el.bellPanel.classList.add('hidden');
  }

  function updateAnnPhotoPreview() {
    const prev = $('annPhotoPreview');
    if (annPhotoData) {
      prev.innerHTML = '<img src="' + esc(annPhotoData) + '" alt=""><button type="button" class="icon-btn" id="btnRemoveAnnPhoto" title="Xóa ảnh">' + ICONS.trash + '</button>';
      $('btnRemoveAnnPhoto').addEventListener('click', () => {
        annPhotoData = null;
        updateAnnPhotoPreview();
      });
    } else {
      prev.innerHTML = '';
    }
  }

  function openAnnounceModal(opts) {
    if (!canPost()) return;
    opts = opts || {};
    editingAnnId = null;
    annPhotoData = null;
    let a = null;
    if (opts.edit) {
      a = announcements.find((x) => x.id === opts.edit) || null;
      if (!a || !ownsAnn(a)) return;
      editingAnnId = a.id;
      annPhotoData = a.photo || null;
    }
    $('annTitle').textContent = a ? 'Sửa thông báo' : 'Đăng thông báo';
    $('aTitle').value = a ? a.title : '';
    $('aDate').value = a ? (a.date || '') : '';
    $('aContent').value = a ? (a.content || '') : '';
    updateAnnPhotoPreview();
    el.announceOverlay.classList.remove('hidden');
    window.setTimeout(() => $('aTitle').focus(), 50);
  }

  function closeAnnounceModal() {
    el.announceOverlay.classList.add('hidden');
    editingAnnId = null;
    annPhotoData = null;
  }

  function deleteAnnouncement(id) {
    const a = announcements.find((x) => x.id === id);
    if (!a || !ownsAnn(a)) return;
    if (!window.confirm('Xóa thông báo "' + a.title + '"?')) return;
    announcements = announcements.filter((x) => x.id !== id);
    persist();
    updateBellBadge();
    render();
    if (!el.bellPanel.classList.contains('hidden')) renderNotifications();
    if (!$('viewMonth').classList.contains('hidden')) renderMonthBoard();
  }

  const ACC_KEY = 'giapha-accounts-v1';
  const SES_KEY = 'giapha-session-v1';
  const ROLE_INFO = {
    admin: { label: 'Quản trị viên' },
    author: { label: 'Người đăng bài' },
    viewer: { label: 'Chỉ xem' }
  };

  function fallbackHash(str) {
    let h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul((h1 ^ c) >>> 0, 16777619) >>> 0;
      h2 = Math.imul((h2 + c + i) >>> 0, 2654435761) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  function hashText(text) {
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((buf) =>
          Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
        );
      }
    } catch (e) { /* thử cách dự phòng */ }
    return Promise.resolve('fb' + fallbackHash(text));
  }

  function makeSalt() {
    const a = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function defaultAccounts() {
    return [
      { username: 'Admin', name: 'Quản trị viên', role: 'admin', pw: 'Admin@192' },
      { username: 'Author', name: 'Người đăng bài', role: 'author', pw: 'Author@192' },
      { username: 'Viewer', name: 'Thành viên chỉ xem', role: 'viewer', pw: 'Viewer@192' }
    ];
  }

  function persistAccounts() {
    try {
      localStorage.setItem(ACC_KEY, JSON.stringify(accounts));
    } catch (e) {
      console.warn('Không thể lưu tài khoản:', e);
    }
  }

  async function ensureAccounts() {
    try {
      const raw = localStorage.getItem(ACC_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length && arr.every((a) => a && typeof a.username === 'string' && typeof a.salt === 'string' && typeof a.hash === 'string' && ROLE_INFO[a.role])) {
          accounts = arr;
          return;
        }
      }
    } catch (e) { /* dữ liệu hỏng */ }
    accounts = [];
    for (const d of defaultAccounts()) {
      const salt = makeSalt();
      accounts.push({ username: d.username, name: d.name, role: d.role, salt: salt, hash: await hashText(salt + d.pw) });
    }
    persistAccounts();
  }

  function findAccount(username) {
    const u = String(username || '').trim().toLowerCase();
    return accounts.find((a) => a.username.toLowerCase() === u) || null;
  }

  async function verifyAccount(acc, pw) {
    if (!acc) return false;
    const h = await hashText(acc.salt + String(pw == null ? '' : pw));
    return h === acc.hash;
  }

  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SES_KEY));
      if (s && typeof s.username === 'string' && ROLE_INFO[s.role]) return s;
    } catch (e) { /* phiên hỏng */ }
    return null;
  }

  function saveSession(s) {
    try {
      if (s) sessionStorage.setItem(SES_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SES_KEY);
    } catch (e) { /* không dùng được sessionStorage */ }
  }

  function isAdmin() { return !!currentUser && currentUser.role === 'admin'; }

  function canPost() { return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'author'); }

  function ownsAnn(a) {
    return !!a && !!currentUser && (isAdmin() || (currentUser.role === 'author' && a.author === currentUser.username));
  }

  function applyRole() {
    const role = currentUser ? currentUser.role : 'viewer';
    document.body.classList.toggle('role-admin', role === 'admin');
    document.body.classList.toggle('role-author', role === 'author');
    document.body.classList.toggle('role-viewer', role === 'viewer');
    $('btnAuthLabel').textContent = currentUser
      ? currentUser.username + ' · ' + ROLE_INFO[role].label
      : 'Tài khoản';
    $('btnAuth').classList.toggle('primary', role === 'admin');
    $('btnAuth').title = currentUser ? 'Tài khoản: ' + currentUser.username : 'Chưa đăng nhập';
    $('authMenu').classList.add('hidden');
    updateBellBadge();
  }

  function showLoginError(msg) {
    const box = $('loginError');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function showGate() {
    currentUser = null;
    saveSession(null);
    applyRole();
    $('loginPw').value = '';
    $('loginError').classList.add('hidden');
    $('loginGate').classList.remove('hidden');
    window.setTimeout(() => $('loginUser').focus(), 60);
  }

  function enterApp(session) {
    currentUser = session;
    saveSession(session);
    lastActivity = Date.now();
    applyRole();
    $('loginGate').classList.add('hidden');
  }

  const IDLE_LIMIT = 30 * 60 * 1000;
  let lastActivity = Date.now();

  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((evName) => {
    document.addEventListener(evName, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
  });

  window.setInterval(() => {
    if (currentUser && Date.now() - lastActivity > IDLE_LIMIT) {
      showGate();
      showLoginError('Phiên đăng nhập đã hết hạn sau 30 phút không hoạt động. Vui lòng đăng nhập lại.');
    }
  }, 15000);

  function showAuthError(msg) {
    const box = $('authError');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function showAuth() {
    el.aPw1.value = '';
    el.aPw2.value = '';
    el.aPw.value = '';
    el.aPw1.classList.remove('invalid');
    el.aPw2.classList.remove('invalid');
    el.aPw.classList.remove('invalid');
    $('authError').classList.add('hidden');
    el.authOverlay.classList.remove('hidden');
    window.setTimeout(() => el.aPw.focus(), 50);
  }

  function closeAuth() {
    el.authOverlay.classList.add('hidden');
  }

  function openAccounts() {
    if (!isAdmin()) return;
    $('accUser').value = '';
    $('accPw').value = '';
    $('accRole').value = 'viewer';
    $('accError').classList.add('hidden');
    renderAccounts();
    $('accountsOverlay').classList.remove('hidden');
  }

  function closeAccounts() {
    $('accountsOverlay').classList.add('hidden');
  }

  function showAccError(msg) {
    const box = $('accError');
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function renderAccounts() {
    const adminCount = accounts.filter((x) => x.role === 'admin').length;
    const rows = accounts.map((a) => {
      const self = currentUser && a.username === currentUser.username;
      const canDel = !self && !(a.role === 'admin' && adminCount <= 1);
      return '<div class="acc-item">' +
        '<div class="acc-main">' +
          '<div class="acc-name">' + esc(a.name || a.username) + (self ? ' <span class="acc-you">(bạn)</span>' : '') + '</div>' +
          '<div class="acc-sub">@' + esc(a.username) + '</div>' +
        '</div>' +
        '<span class="acc-role ' + a.role + '">' + ROLE_INFO[a.role].label + '</span>' +
        (canDel ? '<button class="icon-btn bi-del" data-user="' + esc(a.username) + '" title="Xóa tài khoản">' + ICONS.trash + '</button>' : '') +
      '</div>';
    }).join('');
    $('accountsList').innerHTML = rows;
    $('accountsList').querySelectorAll('.bi-del').forEach((b) => {
      b.addEventListener('click', () => {
        const acc = findAccount(b.dataset.user);
        const nAdmin = accounts.filter((x) => x.role === 'admin').length;
        if (!acc || acc.username === currentUser.username) return;
        if (acc.role === 'admin' && nAdmin <= 1) {
          window.alert('Phải giữ lại ít nhất một tài khoản quản trị.');
          return;
        }
        if (!window.confirm('Xóa tài khoản "' + acc.username + '"?')) return;
        accounts = accounts.filter((x) => x !== acc);
        persistAccounts();
        renderAccounts();
      });
    });
  }

  function deletePerson(id) {
    if (!isAdmin()) return;
    const p = byId(id);
    if (!p) return;
    if (!window.confirm('Xóa "' + p.name + '" khỏi gia phả?')) return;
    people = people.filter((q) => q.id !== id);
    people.forEach((q) => {
      q.spouses = (q.spouses || []).filter((s) => s !== id);
      q.parents = (q.parents || []).filter((s) => s !== id);
    });
    if (selectedId === id) selectedId = null;
    collapsed.delete(id);
    persist();
    render();
    select(null);
  }

  function toggleCollapse(id) {
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    render();
  }

  function openModal(opts) {
    if (!isAdmin()) return;
    opts = opts || {};
    editingId = opts.mode === 'edit' ? opts.id : null;
    const p = editingId ? byId(editingId) : null;
    el.modalTitle.textContent = p ? 'Sửa thành viên' : 'Thêm thành viên';
    el.fName.value = p ? p.name : '';
    el.fGender.value = p ? (p.gender || 'o') : 'm';
    el.fBirth.value = p ? p.birth : '';
    el.fDeath.value = p ? p.death : '';
    el.fNote.value = p ? p.note : '';
    el.fHometown.value = p ? p.hometown : '';
    el.fJob.value = p ? p.job : '';
    el.fAddress.value = p ? p.address : '';
    el.fPhone.value = p ? p.phone : '';
    el.fEmail.value = p ? p.email : '';
    photoData = p ? p.photo : null;
    updatePhotoPreview();

    const exclude = new Set(editingId ? [editingId].concat([...descendantIds(editingId)]) : []);
    const others = people
      .filter((q) => !exclude.has(q.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const withYears = (q) => esc(q.name) + (yearsStr(q) ? ' (' + esc(yearsStr(q)) + ')' : '');
    const father = p && p.parents[0] ? p.parents[0] : '';
    const mother = p && p.parents[1] ? p.parents[1] : '';
    const optHtml = (sel) => '<option value="">-- Không --</option>' + others.map((q) =>
      '<option value="' + q.id + '"' + (q.id === sel ? ' selected' : '') + '>' + withYears(q) + '</option>'
    ).join('');
    el.fFather.innerHTML = optHtml(opts.presetFather || father);
    el.fMother.innerHTML = optHtml(opts.presetMother || mother);

    const spSet = new Set(p ? p.spouses : (opts.presetSpouses || []));
    el.fSpouses.innerHTML = others.map((q) =>
      '<label class="check-item"><input type="checkbox" value="' + q.id + '"' + (spSet.has(q.id) ? ' checked' : '') + '><span>' + withYears(q) + '</span></label>'
    ).join('');

    el.modalOverlay.classList.remove('hidden');
    window.setTimeout(() => el.fName.focus(), 50);
  }

  function closeModal() {
    el.modalOverlay.classList.add('hidden');
    editingId = null;
  }

  function updatePhotoPreview() {
    if (photoData) {
      el.photoPreview.innerHTML = '<img src="' + esc(photoData) + '" alt=""><button type="button" class="icon-btn" id="btnRemovePhoto" title="Xóa ảnh">' + ICONS.trash + '</button>';
      $('btnRemovePhoto').addEventListener('click', () => {
        photoData = null;
        updatePhotoPreview();
      });
    } else {
      el.photoPreview.innerHTML = '';
    }
  }

  function saveForm(e) {
    e.preventDefault();
    const name = el.fName.value.trim();
    if (!name) {
      el.fName.classList.add('invalid');
      el.fName.focus();
      return;
    }
    el.fName.classList.remove('invalid');
    const data = {
      name: name,
      gender: el.fGender.value,
      birth: el.fBirth.value.trim(),
      death: el.fDeath.value.trim(),
      note: el.fNote.value.trim(),
      photo: photoData,
      hometown: el.fHometown.value.trim(),
      job: el.fJob.value.trim(),
      address: el.fAddress.value.trim(),
      phone: el.fPhone.value.trim(),
      email: el.fEmail.value.trim(),
      parents: [el.fFather.value, el.fMother.value].filter(Boolean),
      spouses: Array.from(el.fSpouses.querySelectorAll('input:checked')).map((i) => i.value)
    };
    let id = editingId;
    if (id) {
      Object.assign(byId(id), data);
    } else {
      id = uid();
      people.push(Object.assign({ id: id, parents: [], spouses: [] }, data));
    }
    syncSpouses(id);
    persist();
    closeModal();
    render();
    select(id);
    focusPerson(id);
  }

  function isBackground(t) {
    return t === el.canvas || t === el.viewport || t === el.cards ||
      t === el.links || t.tagName === 'path' || t.tagName === 'line' || t.tagName === 'circle';
  }

  el.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!isBackground(e.target) && !e.target.closest('.card')) return;
    panState = { x: e.clientX, y: e.clientY, moved: false };
  });

  window.addEventListener('pointermove', (e) => {
    if (!panState) return;
    const dx = e.clientX - panState.x, dy = e.clientY - panState.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) panState.moved = true;
    if (panState.moved) {
      view.x += dx;
      view.y += dy;
      applyTransform();
    }
    panState.x = e.clientX;
    panState.y = e.clientY;
  });

  window.addEventListener('pointerup', () => {
    if (panState) lastPanMoved = panState.moved;
    panState = null;
    if (lastPanMoved) window.setTimeout(() => { lastPanMoved = false; }, 0);
  });

  el.canvas.addEventListener('click', (e) => {
    if (lastPanMoved) return;
    if (isBackground(e.target)) select(null);
  });

  el.cards.addEventListener('click', (e) => {
    if (lastPanMoved || lastDragMoved) return;
    const act = e.target.closest('.card-action');
    if (act) {
      const card = act.closest('.card');
      if (act.dataset.act === 'edit') openModal({ mode: 'edit', id: card.dataset.id });
      else deletePerson(card.dataset.id);
      return;
    }
    const cb = e.target.closest('.collapse-btn');
    if (cb) {
      toggleCollapse(cb.dataset.id);
      return;
    }
    const card = e.target.closest('.card');
    if (card) select(card.dataset.id);
  });

  el.cards.addEventListener('dblclick', (e) => {
    if (lastPanMoved || !isAdmin()) return;
    const card = e.target.closest('.card');
    if (card) openModal({ mode: 'edit', id: card.dataset.id });
  });

  let dragState = null;
  let lastDragMoved = false;

  el.cards.addEventListener('pointerdown', (e) => {
    if (!isAdmin() || e.button !== 0) return;
    const card = e.target.closest('.card');
    if (!card || e.target.closest('.card-action')) return;
    const p = byId(card.dataset.id);
    if (!p) return;
    dragState = {
      card: card, id: p.id,
      startX: e.clientX, startY: e.clientY,
      baseLeft: parseFloat(card.style.left) || 0,
      baseTop: parseFloat(card.style.top) || 0,
      bx: parseFloat(card.dataset.bx) || 0,
      by: parseFloat(card.dataset.by) || 0,
      moved: false
    };
    e.stopPropagation();
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const ddx = (e.clientX - dragState.startX) / (view.scale || 1);
    const ddy = (e.clientY - dragState.startY) / (view.scale || 1);
    if (!dragState.moved) {
      if (Math.abs(ddx) + Math.abs(ddy) < 4) return;
      dragState.moved = true;
      dragState.card.classList.add('dragging');
    }
    dragState.card.style.left = (dragState.baseLeft + ddx) + 'px';
    dragState.card.style.top = (dragState.baseTop + ddy) + 'px';
  });

  window.addEventListener('pointerup', () => {
    if (!dragState) return;
    const ds = dragState;
    dragState = null;
    if (!ds.moved) return;
    ds.card.classList.remove('dragging');
    const left = parseFloat(ds.card.style.left) || 0;
    const top = parseFloat(ds.card.style.top) || 0;
    const p = byId(ds.id);
    if (p) {
      if (Math.round(left - ds.bx)) p.dx = Math.round(left - ds.bx); else delete p.dx;
      if (Math.round(top - ds.by)) p.dy = Math.round(top - ds.by); else delete p.dy;
      persist();
      render();
    }
    lastDragMoved = true;
    window.setTimeout(() => { lastDragMoved = false; }, 0);
  });

  el.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = el.canvas.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  el.search.addEventListener('input', () => {
    const q = el.search.value.trim().toLowerCase();
    document.querySelectorAll('.card').forEach((c) => {
      const p = byId(c.dataset.id);
      const match = !!q && !!p && (
        p.name.toLowerCase().includes(q) ||
        String(p.birth || '').includes(q) ||
        String(p.death || '').includes(q)
      );
      c.classList.toggle('match', match);
      c.classList.toggle('dim', !!q && !match);
    });
  });

  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('.card.match');
      if (first) {
        select(first.dataset.id);
        focusPerson(first.dataset.id);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('loginGate').classList.contains('hidden')) return;
      if (!el.authOverlay.classList.contains('hidden')) closeAuth();
      else if (!$('accountsOverlay').classList.contains('hidden')) closeAccounts();
      else if (!el.announceOverlay.classList.contains('hidden')) closeAnnounceModal();
      else if (!$('postEditor').classList.contains('hidden')) closePostEditor();
      else if (!$('postOverlay').classList.contains('hidden')) closePostDetail();
      else if (!el.bellPanel.classList.contains('hidden')) closeBell();
      else if (!el.modalOverlay.classList.contains('hidden')) closeModal();
      else if (document.body.classList.contains('tree-fs')) showView('home');
      else if (!lastPanMoved) select(null);
    }
  });

  $('btnAuth').addEventListener('click', () => {
    if (currentUser) $('authMenu').classList.toggle('hidden');
  });

  $('btnChangePw').addEventListener('click', () => {
    $('authMenu').classList.add('hidden');
    showAuth();
  });

  $('btnManageAccounts').addEventListener('click', () => {
    $('authMenu').classList.add('hidden');
    openAccounts();
  });

  $('btnLogout').addEventListener('click', () => {
    $('authMenu').classList.add('hidden');
    showGate();
  });

  $('btnLogoutMain').addEventListener('click', () => {
    showGate();
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('loginUser').value.trim();
    const pw = $('loginPw').value;
    if (!u || !pw) {
      showLoginError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    const acc = findAccount(u);
    if (!acc || !(await verifyAccount(acc, pw))) {
      showLoginError('Sai tên đăng nhập hoặc mật khẩu.');
      $('loginPw').focus();
      return;
    }
    $('loginError').classList.add('hidden');
    $('loginForm').reset();
    enterApp({ username: acc.username, role: acc.role, name: acc.name || acc.username });
  });

  el.authOverlay.addEventListener('mousedown', (e) => {
    if (e.target === el.authOverlay) closeAuth();
  });

  $('accountsOverlay').addEventListener('mousedown', (e) => {
    if (e.target === $('accountsOverlay')) closeAccounts();
  });

  $('btnCloseAccounts').addEventListener('click', closeAccounts);
  $('btnCancelAccount').addEventListener('click', closeAccounts);
  $('btnCloseAuth').addEventListener('click', closeAuth);
  $('btnCancelAuth').addEventListener('click', closeAuth);

  $('accountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdmin()) return;
    const u = $('accUser').value.trim();
    const pw = $('accPw').value;
    const role = $('accRole').value;
    if (!u) { $('accUser').focus(); return; }
    if (findAccount(u)) { showAccError('Tên đăng nhập đã tồn tại.'); return; }
    if (pw.length < 4) { showAccError('Mật khẩu tối thiểu 4 ký tự.'); return; }
    const salt = makeSalt();
    accounts.push({ username: u, name: u, role: role, salt: salt, hash: await hashText(salt + pw) });
    persistAccounts();
    $('accUser').value = '';
    $('accPw').value = '';
    $('accError').classList.add('hidden');
    renderAccounts();
  });

  el.authForm = $('authForm');
  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const acc = findAccount(currentUser.username);
    const v0 = el.aPw.value, v1 = el.aPw1.value, v2 = el.aPw2.value;
    if (!(await verifyAccount(acc, v0))) {
      showAuthError('Mật khẩu hiện tại không đúng.');
      el.aPw.classList.add('invalid');
      el.aPw.focus();
      return;
    }
    el.aPw.classList.remove('invalid');
    if (!v1 || v1.length < 4) {
      showAuthError('Mật khẩu mới tối thiểu 4 ký tự.');
      el.aPw1.classList.add('invalid');
      el.aPw1.focus();
      return;
    }
    if (v1 !== v2) {
      showAuthError('Mật khẩu nhập lại không khớp.');
      el.aPw2.classList.add('invalid');
      el.aPw2.focus();
      return;
    }
    acc.salt = makeSalt();
    acc.hash = await hashText(acc.salt + v1);
    persistAccounts();
    closeAuth();
  });

  document.addEventListener('click', (e) => {
    if (!$('authMenu').classList.contains('hidden') && !e.target.closest('.auth-wrap')) {
      $('authMenu').classList.add('hidden');
    }
  });

  el.modalOverlay.addEventListener('mousedown', (e) => {
    if (e.target === el.modalOverlay) closeModal();
  });

  el.announceOverlay.addEventListener('mousedown', (e) => {
    if (e.target === el.announceOverlay) closeAnnounceModal();
  });

  $('postOverlay').addEventListener('mousedown', (e) => {
    if (e.target === $('postOverlay')) closePostDetail();
  });

  $('postEditor').addEventListener('mousedown', (e) => {
    if (e.target === $('postEditor')) closePostEditor();
  });

  $('btnClosePost').addEventListener('click', closePostDetail);
  $('btnClosePostEd').addEventListener('click', closePostEditor);
  $('btnCancelPostEd').addEventListener('click', closePostEditor);
  $('postForm').addEventListener('submit', savePost);

  $('btnPostPhoto').addEventListener('click', () => $('pPhoto').click());
  $('pPhoto').addEventListener('change', () => {
    const f = $('pPhoto').files && $('pPhoto').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      postPhotoData = reader.result;
      updatePostPhotoPreview();
      $('pPhoto').value = '';
    };
    reader.readAsDataURL(f);
  });

  $('albumContent').addEventListener('click', (e) => {
    const act = e.target.closest('[data-pact]');
    if (act) {
      e.stopPropagation();
      const card = act.closest('.album-card');
      const p = card && postById(card.dataset.post);
      if (!p || !canEditPost(p)) return;
      if (act.dataset.pact === 'edit') openPostEditor(p.album, p.id);
      else deletePost(p.id);
      return;
    }
    const card = e.target.closest('.album-card');
    if (card && card.dataset.post) openPostDetail(card.dataset.post);
  });

  $('btnCloseAnnounce').addEventListener('click', closeAnnounceModal);
  $('btnCancelAnnounce').addEventListener('click', closeAnnounceModal);

  $('btnAnnPhoto').addEventListener('click', () => $('aPhoto').click());
  $('aPhoto').addEventListener('change', () => {
    const f = $('aPhoto').files && $('aPhoto').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      annPhotoData = reader.result;
      updateAnnPhotoPreview();
      $('aPhoto').value = '';
    };
    reader.readAsDataURL(f);
  });

  $('announceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!canPost()) return;
    const title = $('aTitle').value.trim();
    if (!title) {
      $('aTitle').focus();
      return;
    }
    if (editingAnnId) {
      const a = announcements.find((x) => x.id === editingAnnId);
      if (a && ownsAnn(a)) {
        a.title = title;
        a.date = $('aDate').value || '';
        a.content = $('aContent').value.trim();
        a.photo = annPhotoData;
        a.editedAt = Date.now();
      }
    } else {
      announcements.unshift({
        id: uid(),
        title: title,
        date: $('aDate').value || '',
        content: $('aContent').value.trim(),
        photo: annPhotoData,
        author: currentUser.username,
        authorName: currentUser.name || currentUser.username,
        createdAt: Date.now()
      });
    }
    persist();
    closeAnnounceModal();
    updateBellBadge();
    render();
    if (!$('viewMonth').classList.contains('hidden')) renderMonthBoard();
  });

  $('btnBell').addEventListener('click', () => {
    if (el.bellPanel.classList.contains('hidden')) openBell();
    else closeBell();
  });

  document.addEventListener('click', (e) => {
    if (!el.bellPanel.classList.contains('hidden') &&
      !e.target.closest('#bellPanel') && !e.target.closest('#btnBell')) closeBell();
  });

  el.form.addEventListener('submit', saveForm);

  $('btnAdd').addEventListener('click', () => openModal({ mode: 'add' }));
  $('btnAddFirst').addEventListener('click', () => openModal({ mode: 'add' }));
  $('btnCloseModal').addEventListener('click', closeModal);
  $('btnCancel').addEventListener('click', closeModal);

  el.btnPhoto.addEventListener('click', () => el.fPhoto.click());
  el.fPhoto.addEventListener('change', () => {
    const f = el.fPhoto.files && el.fPhoto.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      photoData = reader.result;
      updatePhotoPreview();
      el.fPhoto.value = '';
    };
    reader.readAsDataURL(f);
  });

  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ people: people, announcements: announcements }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gia-pha.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('btnImport').addEventListener('click', () => {
    if (!isAdmin()) return;
    $('importInput').click();
  });
  $('importInput').addEventListener('change', () => {
    const f = $('importInput').files && $('importInput').files[0];
    if (!f) return;
    const isCsv = /\.csv$/i.test(f.name) || /^text\/(csv|plain)/i.test(f.type || '');
    const reader = new FileReader();
    reader.onload = () => {
      if (isCsv) importCsvText(reader.result);
      else importJsonText(reader.result);
      $('importInput').value = '';
    };
    reader.readAsText(f, 'utf-8');
  });

  function importJsonText(raw) {
    try {
      const data = JSON.parse(raw);
      let list = null;
      let anns = [];
      if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.people)) {
        list = data.people;
        if (Array.isArray(data.announcements)) anns = data.announcements;
      }
      if (!list) throw new Error('bad');
      const seen = new Set();
      const str = (v) => (typeof v === 'string' ? v : '');
      const clean = [];
      list.forEach((p) => {
        if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || seen.has(p.id)) return;
        seen.add(p.id);
        const item = {
          id: p.id,
          name: p.name,
          gender: GENDER[p.gender] ? p.gender : 'o',
          birth: str(p.birth),
          death: str(p.death),
          note: str(p.note),
          photo: typeof p.photo === 'string' ? p.photo : null,
          hometown: str(p.hometown),
          job: str(p.job),
          address: str(p.address),
          phone: str(p.phone),
          email: str(p.email),
          parents: Array.isArray(p.parents) ? p.parents.filter((x) => typeof x === 'string' && seen.has(x) && x !== p.id) : [],
          spouses: Array.isArray(p.spouses) ? p.spouses.filter((x) => typeof x === 'string' && seen.has(x) && x !== p.id) : []
        };
        if (typeof p.dx === 'number' && isFinite(p.dx)) item.dx = Math.round(p.dx);
        if (typeof p.dy === 'number' && isFinite(p.dy)) item.dy = Math.round(p.dy);
        clean.push(item);
      });
      if (!clean.length) throw new Error('empty');
      clean.forEach((p) => {
        p.parents = p.parents.filter((x) => seen.has(x));
        p.spouses = p.spouses.filter((x) => seen.has(x));
      });
      const cleanAnn = anns
        .filter((a) => a && typeof a.title === 'string')
        .map((a) => ({
          id: typeof a.id === 'string' ? a.id : uid(),
          title: a.title,
          date: str(a.date),
          content: str(a.content),
          createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now()
        }));
      people = clean;
      announcements = cleanAnn;
      applyImport();
    } catch (err) {
      window.alert('Tệp không hợp lệ. Vui lòng chọn tệp JSON đã xuất từ trang này hoặc tệp CSV theo mẫu Excel.');
    }
  }

  function parseCsvRows(text, delim) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function importCsvText(raw) {
    try {
      const text = String(raw || '').replace(/^\uFEFF/, '');
      const headEnd = text.indexOf('\n');
      const head = headEnd < 0 ? text : text.slice(0, headEnd);
      const cnt = (ch) => head.split(ch).length - 1;
      const semi = cnt(';'), comma = cnt(','), tab = cnt('\t');
      let delim = ',';
      if (semi >= comma && semi >= tab) delim = ';';
      else if (tab > comma && tab > semi) delim = '\t';
      const rows = parseCsvRows(text, delim);
      if (rows.length < 2) throw new Error('empty');
      const norm = (s) => String(s || '').toLowerCase().replace(/[\s./:]/g, '');
      const H = {};
      rows[0].forEach((h, i) => { const k = norm(h); if (!(k in H)) H[k] = i; });
      const col = function () {
        for (let j = 0; j < arguments.length; j++) {
          const k = norm(arguments[j]);
          if (H[k] !== undefined) return H[k];
        }
        return -1;
      };
      const iId = col('Mã', 'Mã thành viên', 'id');
      const iName = col('Họ tên', 'Họ và tên', 'Tên', 'name');
      const iGender = col('Giới tính', 'gender');
      const iBirth = col('Ngày/Năm sinh', 'Ngày sinh', 'Năm sinh', 'Sinh', 'birth');
      const iDeath = col('Ngày/Năm mất', 'Ngày mất', 'Năm mất', 'Mất', 'death');
      const iFather = col('Cha', 'father');
      const iMother = col('Mẹ', 'mother');
      const iSpouse = col('Vợ/Chồng', 'Vợ chồng', 'spouses');
      const iHome = col('Quê quán', 'hometown');
      const iJob = col('Nghề nghiệp', 'job');
      const iAddr = col('Địa chỉ', 'address');
      const iPhone = col('Điện thoại', 'Số điện thoại', 'phone');
      const iEmail = col('Email', 'email');
      const iNote = col('Ghi chú', 'note');
      if (iName < 0) throw new Error('no-name');
      const clean = [];
      const byId = new Map();
      const byName = new Map();
      rows.slice(1).forEach((r, idx) => {
        const get = (i) => (i >= 0 && r[i] !== undefined ? String(r[i]).trim() : '');
        const name = get(iName);
        if (!name) return;
        let id = get(iId);
        if (!id) id = 'p' + (idx + 2) + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        if (byId.has(id)) id = id + 'x' + idx;
        const gRaw = get(iGender).toLowerCase();
        const gender = (gRaw.indexOf('nữ') === 0 || gRaw.indexOf('nu') === 0 || gRaw === 'f') ? 'f'
          : (gRaw.indexOf('khác') === 0 || gRaw.indexOf('khac') === 0 || gRaw === 'o') ? 'o' : 'm';
        const p = {
          id: id, name: name, gender: gender,
          birth: get(iBirth), death: get(iDeath),
          note: get(iNote), photo: null,
          hometown: get(iHome), job: get(iJob), address: get(iAddr),
          phone: get(iPhone), email: get(iEmail),
          parents: [], spouses: [],
          _father: get(iFather), _mother: get(iMother), _spouses: get(iSpouse)
        };
        clean.push(p);
        byId.set(p.id, p);
        if (!byName.has(name)) byName.set(name, p);
      });
      if (!clean.length) throw new Error('empty');
      clean.forEach((p) => {
        const ref = (s) => { if (!s) return null; return byId.get(s) || byName.get(s) || null; };
        const fa = ref(p._father);
        if (fa && fa !== p) p.parents.push(fa.id);
        const mo = ref(p._mother);
        if (mo && mo !== p && p.parents.indexOf(mo.id) < 0) p.parents.push(mo.id);
        p._spouses.split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
          const sp = ref(s);
          if (sp && sp !== p && p.spouses.indexOf(sp.id) < 0) p.spouses.push(sp.id);
        });
        delete p._father;
        delete p._mother;
        delete p._spouses;
      });
      people = clean;
      applyImport();
    } catch (err) {
      window.alert('Không đọc được tệp CSV. Hãy chắc chắn tệp có cột "Họ tên" và được lưu từ mẫu Excel (CSV UTF-8).');
    }
  }

  function applyImport() {
    normalizeAll();
    collapsed.clear();
    selectedId = null;
    persist();
    render();
    fitView();
    hideDetails();
    closeBell();
    updateBellBadge();
    showView('tree');
  }

  $('btnReset').addEventListener('click', () => {
    if (!isAdmin()) return;
    if (!window.confirm('Khôi phục dữ liệu mẫu? Dữ liệu hiện tại sẽ bị thay thế.')) return;
    people = sampleData();
    announcements = sampleAnnouncements();
    collapsed.clear();
    selectedId = null;
    persist();
    render();
    fitView();
    hideDetails();
    closeBell();
    updateBellBadge();
  });

  $('btnZoomIn').addEventListener('click', () => {
    const r = el.canvas.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1.2);
  });
  $('btnZoomOut').addEventListener('click', () => {
    const r = el.canvas.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
  });
  $('btnFit').addEventListener('click', fitView);
  $('btnExitFs').addEventListener('click', () => showView('home'));

  window.addEventListener('resize', () => applyTransform());

  document.querySelectorAll('.mainnav a').forEach((a) => {
    a.addEventListener('click', () => showView(a.dataset.page));
  });

  viewHome.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { showView(go.dataset.goto); return; }
    const per = e.target.closest('[data-person]');
    if (per) {
      showView('tree');
      select(per.dataset.person);
      focusPerson(per.dataset.person);
    }
  });

  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cName.value.trim();
    const msg = cMsg.value.trim();
    if (!msg) { cMsg.focus(); return; }
    const subject = encodeURIComponent('Thu gui Truong Gia Family' + (name ? ' - ' + name : ''));
    const body = encodeURIComponent(msg + (name ? ('\\n\\n' + name) : ''));
    window.location.href = 'mailto:truonggia.family@example.com?subject=' + subject + '&body=' + body;
    contactDone.style.display = 'block';
    cMsg.value = '';
  });

  load();
  loadPosts();
  render();
  fitView();
  applyRole();
  updateBellBadge();
  showView('home');
  tickClock();
  window.setInterval(tickClock, 30000);
  (async () => {
    await ensureAccounts();
    const s = loadSession();
    if (s && findAccount(s.username)) enterApp(s);
    else showGate();
  })();
})();
