// 【视图层】筛选方案分组标签栏：动态注入容器、渲染 tab、长按菜单（只做 DOM，不做业务计算）
const ViewFilterGroup = {
  _barId: 'filterGroupBar',
  _menuId: 'filterGroupMenu',
  _suppressClick: false,
  _docHandler: null,

  /**
   * 把标签栏注入到「我的筛选方案」卡片底部（方案列表下方，不修改既有 HTML 结构）
   */
  inject: () => {
    if (document.getElementById(ViewFilterGroup._barId)) return;
    const body = document.querySelector('#mod-saved .card-body');
    if (!body) return;
    const bar = document.createElement('div');
    bar.id = ViewFilterGroup._barId;
    bar.className = 'filter-group-bar';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', '筛选方案分组');
    // 置于方案列表之后
    const list = body.querySelector('#filterList');
    if (list) {
      body.insertBefore(bar, list.nextSibling);
    } else {
      body.appendChild(bar);
    }
    ViewFilterGroup._bindLongPress(bar);
  },

  /**
   * 渲染分组标签（依赖 StateManager 中的只读快照，不做业务计算）
   */
  render: () => {
    const bar = document.getElementById(ViewFilterGroup._barId);
    if (!bar) return;
    const state = StateManager._state;
    const groups = state.filterGroups || [];
    const fragment = document.createDocumentFragment();

    groups.forEach((g) => {
      const isActive = g.id === state.currentGroupId;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'filter-group-tab' + (isActive ? ' active' : '');
      tab.dataset.action = CONFIG.ACTIONS.SWITCH_FILTER_GROUP;
      tab.dataset.groupId = g.id;
      if (g.id === BusinessFilterGroup.DEFAULT_ID) tab.dataset.default = '1';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.textContent = g.name;
      fragment.appendChild(tab);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'filter-group-btn';
    addBtn.dataset.action = CONFIG.ACTIONS.ADD_FILTER_GROUP;
    addBtn.setAttribute('aria-label', '新建分组');
    addBtn.textContent = '＋';
    fragment.appendChild(addBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'filter-group-btn danger';
    clearBtn.dataset.action = CONFIG.ACTIONS.CLEAR_FILTER_GROUPS;
    clearBtn.setAttribute('aria-label', '清除所有分组');
    clearBtn.textContent = '🧹';
    fragment.appendChild(clearBtn);

    bar.innerHTML = '';
    bar.appendChild(fragment);
  },

  /**
   * 长按非默认 tab 500ms 浮出操作菜单；长按后吞掉紧随的 click
   * @private
   * @param {HTMLElement} bar - 标签栏容器
   */
  _bindLongPress: (bar) => {
    let timer = null;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    bar.addEventListener('pointerdown', (e) => {
      const tab = e.target.closest ? e.target.closest('.filter-group-tab') : null;
      if (!tab || tab.dataset.default === '1') return;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        ViewFilterGroup._suppressClick = true;
        ViewFilterGroup.showMenu(tab.dataset.groupId, { x: startX, y: startY });
        // 兜底复位，避免抑制状态残留吞掉后续正常点击
        setTimeout(() => { ViewFilterGroup._suppressClick = false; }, 600);
      }, 500);
    });

    bar.addEventListener('pointermove', (e) => {
      if (!timer) return;
      // 手指移动超过阈值视为滑动滚动，取消长按
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) clearTimer();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
      bar.addEventListener(type, clearTimer);
    });

    // 捕获阶段拦截长按后的误触 click（先于事件层委托）
    bar.addEventListener('click', (e) => {
      if (!ViewFilterGroup._suppressClick) return;
      ViewFilterGroup._suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  },

  /**
   * 浮出分组操作菜单（定位不超出视口）
   * @param {string} groupId - 分组 id
   * @param {{x:number,y:number}} pos - 长按位置
   */
  showMenu: (groupId, pos) => {
    ViewFilterGroup.closeMenu();
    const state = StateManager._state;
    const group = (state.filterGroups || []).filter(g => g.id === groupId)[0];
    if (!group) return;

    const menu = document.createElement('div');
    menu.id = ViewFilterGroup._menuId;
    menu.className = 'filter-group-menu';
    menu.setAttribute('role', 'menu');

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.dataset.action = CONFIG.ACTIONS.RENAME_FILTER_GROUP;
    renameBtn.dataset.groupId = groupId;
    renameBtn.textContent = '重命名';
    menu.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'del';
    deleteBtn.dataset.action = CONFIG.ACTIONS.DELETE_FILTER_GROUP;
    deleteBtn.dataset.groupId = groupId;
    deleteBtn.textContent = '删除';
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);

    // 视口自适应：水平夹紧、上下翻转
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = pos.x - rect.width / 2;
    left = Math.max(8, Math.min(left, vw - rect.width - 8));
    let top = pos.y + 12;
    if (top + rect.height > vh - 8) top = pos.y - rect.height - 12;
    top = Math.max(8, top);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // 点击空白处关闭（监听器在 closeMenu 中清理，防止泄漏）
    const onDocDown = (e) => {
      if (menu.contains(e.target)) return;
      ViewFilterGroup.closeMenu();
    };
    ViewFilterGroup._docHandler = onDocDown;
    setTimeout(() => {
      if (ViewFilterGroup._docHandler === onDocDown) {
        document.addEventListener('pointerdown', onDocDown, true);
      }
    }, 0);
  },

  /**
   * 关闭并清理菜单
   */
  closeMenu: () => {
    if (ViewFilterGroup._docHandler) {
      document.removeEventListener('pointerdown', ViewFilterGroup._docHandler, true);
      ViewFilterGroup._docHandler = null;
    }
    const menu = document.getElementById(ViewFilterGroup._menuId);
    if (menu) menu.remove();
  }
};
