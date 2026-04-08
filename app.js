(function () {
  'use strict';

  const STORAGE_KEY = 'kdsq-fav:github-config';
  const DEFAULT_CONFIG = {
    githubOwner: '',
    githubRepo: '',
    githubBranch: 'main',
    githubToken: '',
    dataPath: 'data/favorites.json',
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
    searchInput: document.getElementById('searchInput'),
    forumFilter: document.getElementById('forumFilter'),
    favoriteCount: document.getElementById('favoriteCount'),
    lastUpdated: document.getElementById('lastUpdated'),
    statusBanner: document.getElementById('statusBanner'),
    emptyState: document.getElementById('emptyState'),
    favoritesList: document.getElementById('favoritesList'),
  };

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

  function loadConfig() {
    const stored = parseJson(localStorage.getItem(STORAGE_KEY), {});
    return {
      ...DEFAULT_CONFIG,
      ...stored,
    };
  }

  function saveConfig(config) {
    const nextConfig = {
      githubOwner: config.githubOwner.trim(),
      githubRepo: config.githubRepo.trim(),
      githubBranch: (config.githubBranch || DEFAULT_CONFIG.githubBranch).trim(),
      githubToken: config.githubToken.trim(),
      dataPath: (config.dataPath || DEFAULT_CONFIG.dataPath).trim(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    state.config = nextConfig;
    return nextConfig;
  }

  function clearToken() {
    const nextConfig = {
      ...state.config,
      githubToken: '',
    };
    saveConfig(nextConfig);
    fillConfigForm(nextConfig);
  }

  function fillConfigForm(config) {
    elements.githubOwner.value = config.githubOwner || '';
    elements.githubRepo.value = config.githubRepo || '';
    elements.githubBranch.value = config.githubBranch || DEFAULT_CONFIG.githubBranch;
    elements.githubToken.value = config.githubToken || '';
    elements.dataPath.value = config.dataPath || DEFAULT_CONFIG.dataPath;
  }

  function isConfigReady(config) {
    return Boolean(config.githubOwner && config.githubRepo && config.dataPath);
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
    const ref = encodeURIComponent(config.githubBranch || DEFAULT_CONFIG.githubBranch);
    return `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodePath(config.dataPath)}?ref=${ref}&_=${Date.now()}`;
  }

  function buildRawUrl(config) {
    const branch = encodeURIComponent(config.githubBranch || DEFAULT_CONFIG.githubBranch);
    return `https://raw.githubusercontent.com/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/${branch}/${encodePath(config.dataPath)}?_=${Date.now()}`;
  }

  function decodeBase64Utf8(base64Text) {
    const clean = String(base64Text || '').replace(/\n/g, '');
    const binary = atob(clean);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function normalizeItem(item) {
    return {
      id: String(item.id),
      url: item.url,
      title: item.title,
      forumName: item.forumName || '',
      districtName: item.districtName || '',
      author: item.author || '',
      postedAt: item.postedAt || '',
      thumbnailUrl: item.thumbnailUrl || '',
      favoritedAt: item.favoritedAt || '',
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
      return {
        version: 1,
        updatedAt: null,
        items: [],
      };
    }

    const text = await response.text();
    const payload = parseJson(text, null);

    if (!response.ok) {
      throw new Error(payload?.message || 'Failed to fetch favorites from GitHub');
    }

    const decoded = decodeBase64Utf8(payload.content || '');
    const parsed = parseJson(decoded, {
      version: 1,
      updatedAt: null,
      items: [],
    });

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
      return {
        version: 1,
        updatedAt: null,
        items: [],
      };
    }

    if (!response.ok) {
      throw new Error(`Raw fetch failed with status ${response.status}`);
    }

    const text = await response.text();
    const parsed = parseJson(text, {
      version: 1,
      updatedAt: null,
      items: [],
    });

    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeItem) : [],
    };
  }

  async function fetchFavorites(config) {
    const attempts = [];

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

    setBanner('正在从 GitHub 读取收藏数据...', 'neutral');

    try {
      const favorites = await fetchFavorites(config);
      state.items = favorites.items;
      updateForumFilter(state.items);
      renderList();
      elements.lastUpdated.textContent = favorites.updatedAt ? formatDate(favorites.updatedAt) : '未同步';
      setBanner(`读取成功，共 ${state.items.length} 条收藏。`, 'success');
    } catch (error) {
      console.error('[kdsq-favorites-web] Failed to refresh favorites:', error);
      setBanner(error.message || '读取失败，请检查 GitHub 配置或令牌权限。', 'error');
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
      setBanner('已清空本地令牌。重新填写后才能继续读取。', 'success');
    });

    elements.searchInput.addEventListener('input', renderList);
    elements.forumFilter.addEventListener('change', renderList);
  }

  function init() {
    fillConfigForm(state.config);
    bindEvents();

    if (isConfigReady(state.config)) {
      refreshFavorites();
    } else {
      renderList();
    }
  }

  init();
})();
