// 【业务层】筛选方案分组：完整快照捕获/应用、分组增删改、持久化
// 每个分组保存完整筛选状态（方案列表 + 各维度选中项 + 排除/锁定/标记），
// 切换分组时先保存当前状态回原分组，再整体恢复目标分组并重渲染。
// 禁止在本层出现 document / innerHTML / style 等 DOM 操作。
const BusinessFilterGroup = {
  DEFAULT_ID: 'default',
  DEFAULT_NAME: '默认',

  /** 同步节流定时器（状态变化后合并写回） @private */
  _syncTimer: null,

  /**
   * 空维度模板
   * @private
   */
  _emptySelected: () => ({
    zodiac:[], color:[], colorsx:[], type:[], element:[],
    head:[], tail:[], sum:[], sumOdd:[], sumSize:[], tailSize:[], bs:[], hot:[],
    num:[]
  }),

  /**
   * 捕获当前完整筛选快照（深拷贝，避免引用共享）
   * @private
   * @returns {Object} 快照
   */
  _capture: () => {
    const s = StateManager._state;
    return {
      savedFilters: Utils.deepClone(s.savedFilters || []),
      selected: Utils.deepClone(s.selected || BusinessFilterGroup._emptySelected()),
      excluded: Utils.deepClone(s.excluded || []),
      excludeHistory: Utils.deepClone(s.excludeHistory || []),
      lockExclude: !!s.lockExclude,
      locked: Utils.deepClone(s.locked || {}),
      marked: Utils.deepClone(s.marked || {}),
      markCount: Utils.deepClone(s.markCount || {}),
      showAllFilters: !!s.showAllFilters
    };
  },

  /**
   * 构造分组对象
   * @private
   * @param {string} name - 分组名
   * @param {Object|null} snapshot - 快照，null 表示空状态
   * @returns {Object} 分组
   */
  _makeGroup: (name, snapshot) => {
    const now = Date.now();
    const base = {
      id: 'g_' + now + '_' + Math.random().toString(36).slice(2, 7),
      name: name,
      createdAt: now
    };
    return Object.assign(base, snapshot || {
      savedFilters: [],
      selected: BusinessFilterGroup._emptySelected(),
      excluded: [],
      excludeHistory: [],
      lockExclude: false,
      locked: {},
      marked: {},
      markCount: {},
      showAllFilters: false
    });
  },

  /**
   * 生成「分组一/二/三…」默认名（跳过已占用）
   * @private
   */
  _nextName: () => {
    const list = StateManager._state.filterGroups || [];
    const used = {};
    list.forEach(g => { used[g.name] = true; });
    const cn = ['一','二','三','四','五','六','七','八','九','十'];
    for (let i = 0; i < 99; i++) {
      const name = '分组' + (cn[i] || (i + 1));
      if (!used[name]) return name;
    }
    return '分组' + Date.now();
  },

  /**
   * 持久化分组列表与当前分组 id
   * @private
   */
  _persist: () => {
    Storage.set(Storage.KEYS.FILTER_GROUPS, StateManager._state.filterGroups || []);
    Storage.set(Storage.KEYS.CURRENT_GROUP_ID, StateManager._state.currentGroupId || null);
  },

  /**
   * 取当前激活分组
   * @private
   * @returns {Object|null} 分组
   */
  _currentGroup: () => {
    const s = StateManager._state;
    const list = s.filterGroups || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === s.currentGroupId) return list[i];
    }
    return list[0] || null;
  },

  /**
   * 把当前状态写回当前分组快照（用户增删方案后调用，防止旧数据复活）
   */
  syncCurrent: () => {
    const s = StateManager._state;
    if (!s.filterGroups || !s.filterGroups.length) return;
    const g = BusinessFilterGroup._currentGroup();
    if (!g) return;
    const snap = BusinessFilterGroup._capture();
    g.savedFilters = snap.savedFilters;
    g.selected = snap.selected;
    g.excluded = snap.excluded;
    g.excludeHistory = snap.excludeHistory;
    g.lockExclude = snap.lockExclude;
    g.locked = snap.locked;
    g.marked = snap.marked;
    g.markCount = snap.markCount;
    g.showAllFilters = snap.showAllFilters;
    BusinessFilterGroup._persist();
  },

  /**
   * 应用分组快照并整体重渲染（保证所有控件状态同步）
   * @param {Object} g - 目标分组
   */
  applySnapshot: (g) => {
    if (!g) return;
    StateManager.setState({
      savedFilters: Utils.deepClone(g.savedFilters || []),
      selected: Utils.deepClone(g.selected || BusinessFilterGroup._emptySelected()),
      excluded: Utils.deepClone(g.excluded || []),
      excludeHistory: Utils.deepClone(g.excludeHistory || []),
      lockExclude: !!g.lockExclude,
      locked: Utils.deepClone(g.locked || {}),
      marked: Utils.deepClone(g.marked || {}),
      markCount: Utils.deepClone(g.markCount || {}),
      showAllFilters: !!g.showAllFilters,
      currentGroupId: g.id
    }, false);
    // 方案列表同样按分组隔离，写回原有存储键，保持既有功能可用
    Storage.set(Storage.KEYS.SAVED_FILTERS, Utils.deepClone(g.savedFilters || []));
    Render.renderAll();
    if (typeof Render.renderFilterList === 'function') Render.renderFilterList();
    if (typeof ViewFilterGroup !== 'undefined') ViewFilterGroup.render();
    // 记录当前激活分组，刷新后能回到同一分组
    BusinessFilterGroup._persist();
  },

  /**
   * 切换到指定分组
   * @param {string} id - 分组 id
   */
  switchGroup: (id) => {
    const s = StateManager._state;
    if (!id || id === s.currentGroupId) return;
    const target = (s.filterGroups || []).filter(g => g.id === id)[0];
    if (!target) return;
    // 先保存当前状态到原分组，再加载目标分组（顺序不能反）
    BusinessFilterGroup.syncCurrent();
    BusinessFilterGroup.applySnapshot(target);
  },

  /**
   * 新建分组（弹窗命名，默认「分组N」），确认后立即切换
   */
  addGroupPrompt: () => {
    const defaultName = BusinessFilterGroup._nextName();
    GIONGBETA_INPUT_MODAL.show('新建分组', '请输入分组名称', defaultName, (name) => {
      if (name === null) return;
      const finalName = (name.trim() || defaultName).slice(0, 20);
      BusinessFilterGroup.syncCurrent();
      const s = StateManager._state;
      const group = BusinessFilterGroup._makeGroup(finalName, null);
      s.filterGroups.push(group);
      // 新分组为初始空状态，立即切换过去
      BusinessFilterGroup.applySnapshot(group);
      BusinessFilterGroup._persist();
      Toast.show('已新建分组：' + finalName);
    });
  },

  /**
   * 重命名分组（默认分组不可改）
   * @param {string} id - 分组 id
   */
  renameGroupPrompt: (id) => {
    const list = StateManager._state.filterGroups || [];
    const g = list.filter(x => x.id === id)[0];
    if (!g) return;
    if (g.id === BusinessFilterGroup.DEFAULT_ID) {
      Toast.show('默认分组不可重命名');
      return;
    }
    GIONGBETA_INPUT_MODAL.show('重命名分组', '请输入新的分组名称', g.name, (name) => {
      if (name === null) return;
      const finalName = (name.trim() || g.name).slice(0, 20);
      g.name = finalName;
      BusinessFilterGroup._persist();
      if (typeof ViewFilterGroup !== 'undefined') ViewFilterGroup.render();
      Toast.show('已重命名为：' + finalName);
    });
  },

  /**
   * 删除分组（至少保留一个；删当前分组自动切到第一个剩余分组）
   * @param {string} id - 分组 id
   */
  deleteGroupPrompt: (id) => {
    const list = StateManager._state.filterGroups || [];
    if (list.length <= 1) {
      Toast.show('至少保留一个分组');
      return;
    }
    const g = list.filter(x => x.id === id)[0];
    if (!g) return;
    if (g.id === BusinessFilterGroup.DEFAULT_ID) {
      Toast.show('默认分组不可删除');
      return;
    }
    GIONGBETA_CONFIRM_MODAL.show('确定删除分组「' + g.name + '」吗？', (ok) => {
      if (!ok) return;
      const s = StateManager._state;
      const arr = s.filterGroups || [];
      if (arr.length <= 1) return;
      let index = -1;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].id === id) { index = i; break; }
      }
      if (index < 0) return;
      const wasCurrent = s.currentGroupId === id;
      arr.splice(index, 1);
      if (wasCurrent) {
        BusinessFilterGroup.applySnapshot(arr[0]);
      } else {
        BusinessFilterGroup._persist();
      }
      if (typeof ViewFilterGroup !== 'undefined') ViewFilterGroup.render();
      Toast.show('已删除分组');
    });
  },

  /**
   * 一键清除所有分组：只保留「默认」并重置为空状态
   */
  clearAllGroupsPrompt: () => {
    const list = StateManager._state.filterGroups || [];
    if (list.length <= 1 && list[0] && list[0].id === BusinessFilterGroup.DEFAULT_ID) {
      Toast.show('当前只有默认分组');
      return;
    }
    GIONGBETA_CONFIRM_MODAL.show('确定清除所有分组吗？仅保留「默认」分组并重置为空状态。', (ok) => {
      if (!ok) return;
      const s = StateManager._state;
      const def = BusinessFilterGroup._makeGroup(BusinessFilterGroup.DEFAULT_NAME, null);
      def.id = BusinessFilterGroup.DEFAULT_ID;
      s.filterGroups = [def];
      // 清掉旧方案数据，避免成为孤儿数据
      Storage.remove(Storage.KEYS.SAVED_FILTERS);
      BusinessFilterGroup.applySnapshot(def);
      BusinessFilterGroup._persist();
      if (typeof ViewFilterGroup !== 'undefined') ViewFilterGroup.render();
      Toast.show('已清除所有分组');
    });
  },

  /**
   * 状态变化后自动同步当前分组（节流 200ms，避免高频写存储）
   * @private
   */
  _installAutoSync: () => {
    const origin = StateManager._persistCurrentFilter;
    StateManager._persistCurrentFilter = () => {
      if (typeof origin === 'function') {
        try { origin(); } catch(_) {}
      }
      if (!StateManager._state.currentGroupId) return;
      if (BusinessFilterGroup._syncTimer) clearTimeout(BusinessFilterGroup._syncTimer);
      BusinessFilterGroup._syncTimer = setTimeout(() => {
        BusinessFilterGroup._syncTimer = null;
        BusinessFilterGroup.syncCurrent();
      }, 200);
    };
  },

  /**
   * 初始化：加载分组、校正默认分组、恢复当前分组、注入并渲染标签栏
   */
  init: () => {
    const s = StateManager._state;
    let groups = Storage.get(Storage.KEYS.FILTER_GROUPS, null);
    if (!Array.isArray(groups)) groups = [];

    // 首次启用：把已有方案纳入「默认」分组，避免用户数据丢失
    if (!groups.length) {
      const def = BusinessFilterGroup._makeGroup(BusinessFilterGroup.DEFAULT_NAME, BusinessFilterGroup._capture());
      def.id = BusinessFilterGroup.DEFAULT_ID;
      groups = [def];
    }

    // 确保默认分组存在且位于第一位
    let defIndex = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].id === BusinessFilterGroup.DEFAULT_ID) { defIndex = i; break; }
    }
    if (defIndex < 0) {
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].name === BusinessFilterGroup.DEFAULT_NAME) {
          groups[i].id = BusinessFilterGroup.DEFAULT_ID;
          defIndex = i;
          break;
        }
      }
    }
    if (defIndex < 0) {
      const def = BusinessFilterGroup._makeGroup(BusinessFilterGroup.DEFAULT_NAME, null);
      def.id = BusinessFilterGroup.DEFAULT_ID;
      groups.unshift(def);
    } else if (defIndex > 0) {
      groups.unshift(groups.splice(defIndex, 1)[0]);
    }

    s.filterGroups = groups;

    // 当前分组 id 无效时回落到第一个分组
    let currentId = Storage.get(Storage.KEYS.CURRENT_GROUP_ID, null);
    let valid = false;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].id === currentId) { valid = true; break; }
    }
    if (!valid) currentId = groups[0].id;

    if (typeof ViewFilterGroup !== 'undefined') {
      ViewFilterGroup.inject();
    }

    BusinessFilterGroup.applySnapshot(groups.filter(g => g.id === currentId)[0] || groups[0]);
    BusinessFilterGroup._persist();
    BusinessFilterGroup._installAutoSync();

    if (typeof ViewFilterGroup !== 'undefined') ViewFilterGroup.render();
  }
};
