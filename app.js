(function () {
  'use strict';

  const STORAGE_KEY = 'kdsq-fav:github-config';
  const DEFAULT_BRANCH = 'main';
  const DEFAULT_DATA_PATH = 'data/favorites.json';

  const SITE_DEFAULTS = detectSiteDefaults();
  const DEFAULT_CONFIG = {
    githubOwner: SITE_DEFAULTS.githubOwner,
    githubRepo: SITE_DEFAULTS.githubRepo,
    githubBranch: DEFAULT_BRANCH,
    githubToken: '',
    dataPath: DEFAULT_DATA_PATH,
  };

  const EMPTY_FAVORITES = {
    version: 1,
    updatedAt: null,
    items: [],
  };

  const state = {
    items: [],
    config: loadConfig(),
  };

  const elements = {
    configForm: document.getElementById('configForm'),
    githubOwner: document.getElementById('githubOwner'),
    githubRepo: document.getElementById('githubRepo'),
    githubBranch: document.getElementById('githubBranch'),
    githubToken: document.getElementById('githubToken'),
    dataPath: document.getElementById('dataPath'),
    refreshButton: document.getElementById('refreshButton'),
    clearTokenButton: document.getElementById('clearTokenButton'),
    resetConfigButton: document.getElementById('resetConfigButton'),
    searchInput: document.getElementById('searchInput'),
    forumFilter: document.getElementById('forumFilter'),
    favoriteCount: document.getElementById('favoriteCount'),
    lastUpdated: document.getElementById('lastUpdated'),
    statusBanner: document.getElementById('statusBanner'),
    emptyState: document.getElementById('emptyState'),
    favoritesList: document.getElementById('favoritesList'),
  };

  function detectSiteDefaults() {
    const hostname = window.location.hostname || '';
    const pathname = window.location.pathname || '';
    const segments = pathname.split('/').filter(Boolean);

    if (!hostname.endsWith('.github.io')) {
      return {
        githubOwner: '',
        githubRepo: '',
      };
    }

    const githubOwner = hostname.slice(0, -'.github.io'.length);
    const githubRepo = segments[0] || `${githubOwner}.github.io`;

    return {
      githubOwner,
      githubRepo,
    };
  }

  function parseJson(text, fallback) {
    if (!text) {
      return fallback;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.warn('[kdsq-favorites-web] Failed to parse JSON:', error);
      return fallback;
    }
  }

  function normalizeConfig(config) {
    return {
      githubOwner: String(config?.githubOwner || DEFAULT_CONFIG.githubOwner).trim(),
      githubRepo: String(config?.githubRepo || DEFAULT_CONFIG.githubRepo).trim(),
      githubBranch: String(config?.githubBranch || DEFAULT_BRANCH).trim(),
      githubToken: String(config?.githubToken || '').trim(),
      dataPath: String(config?.dataPath || DEFAULT_DATA_PATH).trim(),
    };
  }

  function loadConfig() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEY), {});
    return normalizeConfig({
      ...DEFAULT_CONFIG,
      ...stored,
    });
  }

  function saveConfig(config) {
    const nextConfig = normalizeConfig(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    state.config = nextConfig;
    return nextConfig;
  }

  function resetConfig() {
    localStorage.removeItem(STORAGE_KEY);
    state.config = normalizeConfig(DEFAULT_CONFIG);
    fillConfigForm(state.config);
    return state.config;
  }

  function clearToken() {
    const nextConfig = saveConfig({
      ...state.config,
      githubToken: '',
    });

    fillConfigForm(nextConfig);
  }

  function fillConfigForm(config) {
    elements.githubOwner.value = config.githubOwner || '';
    elements.githubRepo.value = config.githubRepo || '';
    elements.githubBranch.value = config.githubBranch || DEFAULT_BRANCH;
    elements.githubToken.value = config.githubToken || '';
    elements.dataPath.value = config.dataPath || DEFAULT_DATA_PATH;
  }

  function isConfigReady(config) {
    return Boolean(config.githubOwner && config.githubRepo && config.dataPath);
  }

  function sameRepoConfig(left, right) {
    return [
      'githubOwner',
      'githubRepo',
      'githubBranch',
      'dataPath',
    ].every((field) => String(left?.[field] || '').trim() === String(right?.[field] || '').trim());
  }

  function getFallbackConfig(baseConfig) {
    return normalizeConfig({
      ...DEFAULT_CONFIG,
      githubToken: baseConfig?.githubToken || '',
    });
  }

  function canTryFallback(config) {
    if (!isConfigReady(DEFAULT_CONFIG)) {
      return false;
    }

    return !sameRepoConfig(config, getFallbackConfig(config));
  }

  function setBanner(message, tone) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.dataset.tone = tone || 'neutral';
  }

  function encodePath(path) {
    return path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function buildApiUrl(config) {
    const ref = encodeURIComponent(config.githubBranch || DEFAULT_BRANCH);
    const owner = encodeURIComponent(config.githubOwner);
    const repo = encodeURIComponent(config.githubRepo);
    return `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(config.dataPath)}?ref=${ref}&_=${Date.now()}`;
  }

  function buildLocalUrl(config) {
    const cleanPath = String(config.dataPath || DEFAULT_DATA_PATH).replace(/^\/+/, '');
    return `./${cleanPath}?_=${Date.now()}`;
  }

  function buildRawUrl(config) {
    const branch = encodeURIComponent(config.githubBranch || DEFAULT_BRANCH);
    const owner = encodeURIComponent(config.githubOwner);
    const repo = encodeURIComponent(config.githubRepo);
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodePath(config.dataPath)}?_=${Date.now()}`;
  }

  function decodeBase64Utf8(base64Text) {
    const clean = String(base64Text || '').replace(/\n/g, '');
    const binary = atob(clean);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function normalizeItem(item) {
    return {
      id: String(item?.id || ''),
      url: item?.url || '',
      title: item?.title || '未命名帖子',
      forumName: item?.forumName || '',
      districtName: item?.districtName || '',
      author: item?.author || '',
      postedAt: item?.postedAt || '',
      thumbnailUrl: item?.thumbnailUrl || '',
      favoritedAt: item?.favoritedAt || '',
    };
  }

  async function fetchFavoritesViaApi(config, useAuth) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (useAuth && config.githubToken) {
      headers.Authorization = `Bearer ${config.githubToken}`;
    }

    const response = await fetch(buildApiUrl(config), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (response.status === 404) {
      return EMPTY_FAVORITES;
    }

    const text = await response.text();
    const payload = parseJson(text, null);

    if (!response.ok) {
      throw new Error(payload?.message || 'GitHub API 读取失败');
    }

    const decoded = decodeBase64Utf8(payload?.content || '');
    const parsed = parseJson(decoded, EMPTY_FAVORITES);

    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
    };
  }

  async function fetchFavoritesViaRaw(config) {
    const response = await fetch(buildRawUrl(config), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (response.status === 404) {
      return EMPTY_FAVORITES;
    }

    if (!response.ok) {
      throw new Error(`Raw 读取失败，状态码 ${response.status}`);
    }

    const text = await response.text();
    const parsed = parseJson(text, EMPTY_FAVORITES);

    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
    };
  }

  async function fetchFavoritesViaLocal(config) {
    const response = await fetch(buildLocalUrl(config), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (response.status === 404) {
      return EMPTY_FAVORITES;
    }

    if (!response.ok) {
      throw new Error(`本地文件读取失败，状态码 ${response.status}`);
    }

    const text = await response.text();
    const parsed = parseJson(text, EMPTY_FAVORITES);

    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
    };
  }

  async function fetchFavorites(config) {
    const attempts = [() => fetchFavoritesViaLocal(config)];

    if (config.githubToken) {
      attempts.push(() => fetchFavoritesViaApi(config, true));
    }

    attempts.push(() => fetchFavoritesViaApi(config, false));
    attempts.push(() => fetchFavoritesViaRaw(config));

    let lastError = null;

    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Failed to fetch favorites');
  }

  function formatDate(value) {
    if (!value) {
      return '未记录';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function updateForumFilter(items) {
    const currentValue = elements.forumFilter.value;
    const forums = Array.from(new Set(items.map((item) => item.forumName).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, 'zh-CN'));

    elements.forumFilter.innerHTML = '<option value="">全部版块</option>';

    for (const forum of forums) {
      const option = document.createElement('option');
      option.value = forum;
      option.textContent = forum;
      elements.forumFilter.appendChild(option);
    }

    if (forums.includes(currentValue)) {
      elements.forumFilter.value = currentValue;
    }
  }

  function getFilteredItems() {
    const keyword = elements.searchInput.value.trim().toLowerCase();
    const forum = elements.forumFilter.value.trim();

    return state.items
      .filter((item) => {
        if (forum && item.forumName !== forum) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        return [item.title, item.forumName, item.districtName, item.author]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      })
      .sort((left, right) => new Date(right.favoritedAt).getTime() - new Date(left.favoritedAt).getTime());
  }

  function renderList() {
    const items = getFilteredItems();
    elements.favoriteCount.textContent = String(items.length);
    elements.favoritesList.innerHTML = '';
    elements.emptyState.hidden = items.length > 0;

    if (!items.length) {
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const item of items) {
      const article = document.createElement('article');
      article.className = 'favorite-card';

      const chips = [
        item.forumName ? `<span class="favorite-chip">版块: ${escapeHtml(item.forumName)}</span>` : '',
        item.districtName ? `<span class="favorite-chip">分区: ${escapeHtml(item.districtName)}</span>` : '',
        item.author ? `<span class="favorite-chip">作者: ${escapeHtml(item.author)}</span>` : '',
      ].filter(Boolean).join('');

      const media = item.thumbnailUrl
        ? `<a class="favorite-thumb" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeAttribute(item.thumbnailUrl)}" alt="${escapeAttribute(item.title)}" loading="lazy" /></a>`
        : '<div class="favorite-thumb favorite-thumb-empty" aria-hidden="true"></div>';

      article.innerHTML = `
        <div class="favorite-card-inner">
          ${media}
          <div class="favorite-content">
            <h3>${escapeHtml(item.title)}</h3>
            <div class="favorite-meta">${chips}</div>
            <div class="favorite-footer">
              <div class="favorite-time">收藏时间: ${escapeHtml(formatDate(item.favoritedAt))}</div>
              <a class="favorite-link" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">打开原帖</a>
            </div>
          </div>
        </div>
      `;

      fragment.appendChild(article);
    }

    elements.favoritesList.appendChild(fragment);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function applyFavorites(favorites) {
    state.items = favorites.items;
    updateForumFilter(state.items);
    renderList();
    elements.lastUpdated.textContent = favorites.updatedAt ? formatDate(favorites.updatedAt) : '未同步';
  }

  async function refreshFavorites() {
    const config = state.config;

    if (!isConfigReady(config)) {
      setBanner('配置还不完整，至少需要 Owner、Repo 和 Data Path。', 'error');
      state.items = [];
      updateForumFilter([]);
      renderList();
      elements.lastUpdated.textContent = '未同步';
      return;
    }

    setBanner('正在读取收藏数据...', 'neutral');

    try {
      const favorites = await fetchFavorites(config);
      applyFavorites(favorites);
      setBanner(`读取成功，共 ${state.items.length} 条收藏。`, 'success');
    } catch (primaryError) {
      if (canTryFallback(config)) {
        try {
          const fallbackConfig = getFallbackConfig(config);
          const favorites = await fetchFavorites(fallbackConfig);
          saveConfig(fallbackConfig);
          fillConfigForm(fallbackConfig);
          applyFavorites(favorites);
          setBanner('检测到旧配置，已自动切回当前站点配置并恢复读取。', 'success');
          return;
        } catch (fallbackError) {
          console.error('[kdsq-favorites-web] Fallback refresh failed:', fallbackError);
        }
      }

      console.error('[kdsq-favorites-web] Failed to refresh favorites:', primaryError);
      setBanner(primaryError.message || '读取失败，请检查 GitHub 配置。', 'error');
      state.items = [];
      updateForumFilter([]);
      renderList();
      elements.lastUpdated.textContent = '读取失败';
    }
  }

  function bindEvents() {
    elements.configForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      saveConfig({
        githubOwner: elements.githubOwner.value,
        githubRepo: elements.githubRepo.value,
        githubBranch: elements.githubBranch.value,
        githubToken: elements.githubToken.value,
        dataPath: elements.dataPath.value,
      });

      await refreshFavorites();
    });

    elements.refreshButton.addEventListener('click', refreshFavorites);
    elements.clearTokenButton.addEventListener('click', () => {
      clearToken();
      setBanner('本地 Token 已清空。公开仓库读取可以直接继续。', 'success');
    });

    elements.resetConfigButton.addEventListener('click', async () => {
      resetConfig();
      setBanner('本地配置已重置，正在按当前站点默认配置重新读取。', 'success');
      await refreshFavorites();
    });

    elements.searchInput.addEventListener('input', renderList);
    elements.forumFilter.addEventListener('change', renderList);
  }

  function init() {
    fillConfigForm(state.config);
    bindEvents();

    if (isConfigReady(state.config)) {
      refreshFavorites();
      return;
    }

    renderList();
    setBanner('先填写配置，或直接使用当前站点的默认仓库配置。', 'neutral');
  }

  init();
})();
