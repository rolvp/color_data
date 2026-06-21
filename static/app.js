/* ============================================================
   Color Aging Data Management System - Frontend App
   ============================================================ */

// ============================================================
// State
// ============================================================
const State = {
    samples: [],
    allMeasurements: [],
    selectedSampleId: null,
    sampleDownloadMode: 'export',
    activeAgingFilter: null,
    currentTab: 'details',
    currentView: 'empty',
    measurements: [],
    expandedMeasurementGroups: new Set(),
    showAllColorTrendAngles: false,
    selectedChartAngles: null,
    chartDataCache: null,
    compareSelections: [],
    photos: [],
    chartInstance: null,
    isSidebarCollapsed: false,
};

const AGING_FILTER_RULES = {
    xenon: ['fs41', '氙灯老化', '氙灯老化方式'],
    double85: ['85-85', '85 85', '85/85', '双85'],
    uv: ['g154', 'wr20', '紫外老化'],
};

// ============================================================
// API Layer
// ============================================================
const API = {
    async request(method, url, body) {
        const opts = { method, headers: {} };
        if (body && !(body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        } else if (body instanceof FormData) {
            opts.body = body;
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            const errBody = await res.text();
            let errMsg = `HTTP ${res.status}`;
            try {
                const errJson = JSON.parse(errBody);
                errMsg = errJson.detail || errMsg;
            } catch {}
            console.error(`[API] ${method} ${url} failed (${res.status}):`, errBody);
            throw new Error(errMsg);
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return res.json();
        }
        return res;
    },

    getSamples() { return API.request('GET', '/api/samples'); },
    getSample(id) { return API.request('GET', `/api/samples/${id}`); },
    createSample(data) { return API.request('POST', '/api/samples', data); },
    updateSample(id, data) { return API.request('PUT', `/api/samples/${id}`, data); },
    deleteSample(id) { return API.request('DELETE', `/api/samples/${id}`); },

    getAllMeasurements() { return API.request('GET', '/api/measurements'); },
    getMeasurements(sampleId) { return API.request('GET', `/api/samples/${sampleId}/measurements`); },
    createMeasurement(sampleId, data) { return API.request('POST', `/api/samples/${sampleId}/measurements`, data); },
    updateMeasurement(id, data) { return API.request('PUT', `/api/measurements/${id}`, data); },
    deleteMeasurement(id) { return API.request('DELETE', `/api/measurements/${id}`); },

    getPhotos(sampleId) { return API.request('GET', `/api/samples/${sampleId}/photos`); },
    uploadPhoto(sampleId, file, measurementId, notes) {
        const fd = new FormData();
        fd.append('file', file);
        if (measurementId) fd.append('measurement_id', measurementId);
        if (notes) fd.append('notes', notes);
        return API.request('POST', `/api/samples/${sampleId}/photos`, fd);
    },
    deletePhoto(id) { return API.request('DELETE', `/api/photos/${id}`); },

    search(q) { return API.request('GET', `/api/search?q=${encodeURIComponent(q)}`); },
    getChartData(sampleId) { return API.request('GET', `/api/samples/${sampleId}/chart`); },
    getUploadTemplateUrl(sampleId) { return `/api/samples/${sampleId}/upload-template`; },
    getSampleExportUrl(sampleId) { return `/api/samples/${sampleId}/export`; },
    // Export returns binary, handled separately in handleExport()
};

async function downloadFile(url, fallbackFilename) {
    const res = await fetch(url);
    if (!res.ok) {
        const errBody = await res.text();
        let errMsg = `HTTP ${res.status}`;
        try {
            const errJson = JSON.parse(errBody);
            errMsg = errJson.detail || errMsg;
        } catch {}
        throw new Error(errMsg);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, '').trim()) : fallbackFilename;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// Modal
// ============================================================
function showModal(title, bodyHtml, onConfirm, confirmText = '确定', danger = false) {
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    const footerEl = document.getElementById('modalFooter');

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;

    footerEl.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = closeModal;
    footerEl.appendChild(cancelBtn);

    if (onConfirm) {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = async () => {
            try {
                confirmBtn.disabled = true;
                confirmBtn.textContent = '处理中...';
                await onConfirm();
                closeModal();
            } catch (e) {
                console.error('[Modal] Error:', e);
                showToast(e.message || '操作失败', 'error');
                confirmBtn.disabled = false;
                confirmBtn.textContent = confirmText;
            }
        };
        footerEl.appendChild(confirmBtn);
    }

    overlay.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ============================================================
// Lightbox
// ============================================================
function showLightbox(photoUrl, info) {
    const lb = document.getElementById('lightbox');
    document.getElementById('lightboxImg').src = photoUrl;
    document.getElementById('lightboxInfo').textContent = info || '';
    lb.style.display = 'flex';
}

function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
});

function normalizeFilterText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchesAgingFilter(sample, filterKey) {
    if (!filterKey) return true;
    const haystack = normalizeFilterText(sample?.test_condition);
    if (!haystack) return false;
    const keywords = AGING_FILTER_RULES[filterKey] || [];
    return keywords.some(keyword => haystack.includes(keyword));
}

function getVisibleSamples() {
    return (State.samples || []).filter(sample => matchesAgingFilter(sample, State.activeAgingFilter));
}

function getVisibleMeasurements() {
    return (State.allMeasurements || []).filter(measurement => matchesAgingFilter({
        test_condition: measurement.sample_test_condition,
    }, State.activeAgingFilter));
}

function updateAgingFilterCards() {
    document.querySelectorAll('.aging-filter-card').forEach(card => {
        card.classList.toggle('is-active', card.dataset.agingFilter === State.activeAgingFilter);
    });
}

function applyAgingFilterView() {
    const visibleSamples = getVisibleSamples();
    renderSidebar(visibleSamples);
    updateAgingFilterCards();

    if (State.currentView === 'all-samples') {
        renderAllSamplesOverview(visibleSamples);
    } else if (State.currentView === 'all-measurements') {
        renderAllMeasurementsOverview(getVisibleMeasurements());
    }
}

// ============================================================
// Sidebar Rendering
// ============================================================
function renderSidebar(samples) {
    const listEl = document.getElementById('sampleList');
    const emptyEl = document.getElementById('sidebarEmpty');
    const totalSamplesEl = document.getElementById('totalSamplesText');
    const totalMeasurementsEl = document.getElementById('totalMeasurementsText');

    const totalSamples = (samples || []).length;
    const totalMeasurements = (samples || []).reduce((sum, sample) => sum + (sample.measurement_count || 0), 0);

    if (totalSamplesEl) {
        totalSamplesEl.textContent = `样品总数：${totalSamples}`;
    }
    if (totalMeasurementsEl) {
        totalMeasurementsEl.textContent = `测量记录总数：${totalMeasurements}`;
    }

    // Remove all sample items (keep emptyEl if it exists)
    listEl.querySelectorAll('.sample-item').forEach(el => el.remove());

    if (!samples || samples.length === 0) {
        emptyEl.style.display = 'block';
        return;
    }

    emptyEl.style.display = 'none';

    samples.forEach(s => {
        const deltaClass = getDeltaClass(s.latest_delta_e);
        const deltaText = s.latest_delta_e != null ? s.latest_delta_e.toFixed(2) : '-';
        const activeClass = s.id === State.selectedSampleId ? ' active' : '';

        const item = document.createElement('div');
        item.className = `sample-item${activeClass}`;
        item.dataset.id = s.id;
        item.innerHTML = `
            <div class="sample-item-name">${escapeHtml(s.name)}</div>
            <div class="sample-item-code">${escapeHtml(s.code)}</div>
            <div class="sample-item-meta">
                <span>测量: ${s.measurement_count || 0}</span>
                <span>ΔE: <span class="delta-badge ${deltaClass}">${deltaText}</span></span>
            </div>
        `;
        item.addEventListener('click', () => selectSample(s.id));
        listEl.appendChild(item);
    });
}

function getDeltaClass(deltaE) {
    if (deltaE == null) return 'delta-none';
    if (deltaE < 1) return 'delta-green';
    if (deltaE < 3) return 'delta-yellow';
    return 'delta-red';
}

function setMainView(view) {
    State.currentView = view;
    const mainEmpty = document.getElementById('mainEmpty');
    const overviewContainer = document.getElementById('overviewContainer');
    const detailContainer = document.getElementById('detailContainer');
    const allSamplesCard = document.getElementById('allSamplesCard');
    const allMeasurementsCard = document.getElementById('allMeasurementsCard');

    if (mainEmpty) mainEmpty.style.display = view === 'empty' ? 'block' : 'none';
    if (overviewContainer) overviewContainer.style.display = view.startsWith('all-') ? 'flex' : 'none';
    if (detailContainer) detailContainer.style.display = view === 'sample-detail' ? 'block' : 'none';
    if (allSamplesCard) allSamplesCard.style.display = view === 'all-samples' ? 'block' : 'none';
    if (allMeasurementsCard) allMeasurementsCard.style.display = view === 'all-measurements' ? 'block' : 'none';

    document.getElementById('showAllSamplesBtn')?.classList.toggle('is-active', view === 'all-samples');
    document.getElementById('showAllMeasurementsBtn')?.classList.toggle('is-active', view === 'all-measurements');
}

function renderAllSamplesOverview(samples) {
    const tbody = document.getElementById('allSamplesTbody');
    if (!tbody) return;

    if (!samples || samples.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无样品数据</td></tr>';
        return;
    }

    tbody.innerHTML = samples.map(sample => {
        return `
            <tr>
                <td>${escapeHtml(sample.name)}</td>
                <td>${escapeHtml(sample.code)}</td>
                <td>${escapeHtml(sample.brand || '-')}</td>
                <td>${escapeHtml(sample.model || '-')}</td>
                <td>${escapeHtml(sample.test_condition || '-')}</td>
                <td>${escapeHtml(sample.aging_time || '-')}</td>
                <td>${formatDate(sample.updated_at)}</td>
            </tr>
        `;
    }).join('');
}

function renderAllMeasurementsOverview(measurements) {
    const tbody = document.getElementById('allMeasurementsTbody');
    if (!tbody) return;

    if (!measurements || measurements.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无测量记录</td></tr>';
        return;
    }

    tbody.innerHTML = measurements.map(measurement => {
        return `
            <tr>
                <td>${escapeHtml(measurement.sample_name)}</td>
                <td>${escapeHtml(measurement.sample_code)}</td>
                <td>${escapeHtml(measurement.sample_brand || '-')}</td>
                <td>${escapeHtml(measurement.sample_model || '-')}</td>
                <td>${escapeHtml(measurement.sample_test_condition || '-')}</td>
                <td>${escapeHtml(measurement.sample_aging_time || '-')}</td>
                <td>${formatDate(measurement.measurement_date)}</td>
            </tr>
        `;
    }).join('');
}

async function showAllSamplesView() {
    setMainView('all-samples');
    renderAllSamplesOverview(State.samples);
}

async function showAllMeasurementsView() {
    setMainView('all-measurements');
    try {
        State.allMeasurements = await API.getAllMeasurements();
        renderAllMeasurementsOverview(State.allMeasurements);
    } catch (e) {
        showToast('加载全部测量记录失败: ' + e.message, 'error');
    }
}

// ============================================================
// Sample Selection & Detail Rendering
// ============================================================
async function selectSample(id, options = {}) {
    State.selectedSampleId = id;
    State.sampleDownloadMode = options.downloadMode || 'export';
    State.currentTab = 'details';
    setMainView('sample-detail');
    State.expandedMeasurementGroups = new Set();
    State.showAllColorTrendAngles = false;
    State.selectedChartAngles = null;
    State.chartDataCache = null;

    // Update sidebar active state
    document.querySelectorAll('.sample-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });

    activateTab('details');

    await refreshDetailView();
}

function updateDownloadButton() {
    const btn = document.getElementById('downloadTemplateBtn');
    if (!btn) return;
    btn.textContent = State.sampleDownloadMode === 'template' ? '下载数据模板' : '下载样品数据';
}

async function refreshDetailView() {
    const id = State.selectedSampleId;
    if (!id) return;

    try {
        const sample = await API.getSample(id);
        renderDetailsTab(sample);

        State.measurements = await API.getMeasurements(id);
        renderMeasurementsTab(State.measurements);
        renderComparisonTab();

        State.photos = await API.getPhotos(id);
        renderPhotosTab(State.photos);

        try {
            const chartData = await API.getChartData(id);
            State.chartDataCache = chartData;
            renderChartsTab(chartData);
        } catch (e) {
            document.getElementById('chartEmpty').style.display = 'block';
            document.getElementById('agingChart').style.display = 'none';
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function renderDetailsTab(sample) {
    const deltaClass = getDeltaClass(sample.latest_delta_e);
    const deltaText = sample.latest_delta_e != null ? sample.latest_delta_e.toFixed(2) : '-';

    document.getElementById('detailSampleName').textContent = sample.name;
    updateDownloadButton();
    document.getElementById('detailSections').innerHTML = `
        <div class="detail-sections">
            <section class="detail-section">
                <div class="detail-section-header">Part 1 样品标记</div>
                <div class="info-grid detail-info-grid">
                    ${renderDetailItem('样品名称', sample.name)}
                    ${renderDetailItem('样品编号', sample.code)}
                    ${renderDetailItem('类别', sample.category)}
                    ${renderDetailItem('品牌', sample.brand)}
                    ${renderDetailItem('型号', sample.model)}
                    ${renderDetailItem('颜色', sample.color_name)}
                    ${renderDetailItem('其他', sample.other_info)}
                </div>
            </section>
            <section class="detail-section">
                <div class="detail-section-header">Part 2 老化标记</div>
                <div class="info-grid detail-info-grid">
                    ${renderDetailItem('老化条件', sample.test_condition)}
                    ${renderDetailItem('老化时间', sample.aging_time)}
                    ${renderDetailItem('设备信息', sample.device_info)}
                </div>
            </section>
            <section class="detail-section">
                <div class="detail-section-header">Part 3 测试标记</div>
                <div class="info-grid detail-info-grid">
                    ${renderDetailItem('测试设备', sample.test_device)}
                    ${renderDetailItem('测量测试', sample.measurement_test)}
                    ${renderDetailItem('描述', sample.description)}
                    <div class="info-item"><label>最新 DELTA E</label><span class="delta-badge ${deltaClass}">${deltaText}</span></div>
                    ${renderDetailItem('照片数量', String(sample.photo_count ?? 0))}
                    ${renderDetailItem('创建时间', formatDate(sample.created_at))}
                    ${renderDetailItem('更新时间', formatDate(sample.updated_at))}
                </div>
            </section>
        </div>
    `;
}

function renderDetailItem(label, value) {
    return `<div class="info-item"><label>${escapeHtml(label)}</label><span>${escapeHtml(value || '-')}</span></div>`;
}

// ============================================================
// Measurements Tab
// ============================================================
function renderMeasurementsTab(measurements) {
    const tbody = document.getElementById('measurementsTbody');

    if (measurements.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="11">暂无测量数据</td></tr>';
        return;
    }

    const rows = [];
    const seenGroups = new Set();

    measurements.forEach(m => {
        const isMT12 = (m.device || 'SP64') === 'MT12';
        if (!isMT12) {
            rows.push(renderMeasurementRow(m, {
                compareHtml: renderCompareButton(null, m),
            }));
            return;
        }

        const groupKey = getMeasurementGroupKey(m);
        if (seenGroups.has(groupKey)) {
            return;
        }
        seenGroups.add(groupKey);

        const groupMeasurements = measurements
            .filter(item => getMeasurementGroupKey(item) === groupKey)
            .sort((left, right) => {
                const leftIndex = MT12_ANGLES.indexOf(left.angle || '');
                const rightIndex = MT12_ANGLES.indexOf(right.angle || '');
                return leftIndex - rightIndex;
            });
        const representative = groupMeasurements.find(item => item.angle === 'r45as45') || groupMeasurements[0];
        const detailMeasurements = [
            representative,
            ...groupMeasurements.filter(item => item.id !== representative.id),
        ];
        const expanded = State.expandedMeasurementGroups.has(groupKey);
        const groupPhotoCount = groupMeasurements.reduce((sum, item) => sum + (item.photo_count || 0), 0);

        if (!expanded) {
            rows.push(renderMeasurementRow(representative, {
                rowClass: 'mt12-summary-row',
                photoCountOverride: groupPhotoCount,
                compareHtml: renderCompareButton(groupMeasurements),
                toggleHtml: `<button class="btn btn-outline btn-sm toggle-meas-group-btn" data-group-key="${escapeHtml(groupKey)}">展开其他角度 (${Math.max(groupMeasurements.length - 1, 0)})</button>`,
            }));
            return;
        }

        detailMeasurements.forEach((item, index) => {
            rows.push(renderMeasurementRow(item, {
                rowClass: index === 0 ? 'mt12-summary-row is-expanded' : 'mt12-detail-row',
                photoCountOverride: index === 0 ? groupPhotoCount : 0,
                compareHtml: renderCompareButton(groupMeasurements, item),
                toggleHtml: index === 0
                    ? `<button class="btn btn-outline btn-sm toggle-meas-group-btn" data-group-key="${escapeHtml(groupKey)}">收起其他角度</button>`
                    : '',
            }));
        });
    });

    tbody.innerHTML = rows.join('');

    tbody.querySelectorAll('.toggle-meas-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupKey = btn.dataset.groupKey;
            if (!groupKey) return;
            if (State.expandedMeasurementGroups.has(groupKey)) {
                State.expandedMeasurementGroups.delete(groupKey);
            } else {
                State.expandedMeasurementGroups.add(groupKey);
            }
            renderMeasurementsTab(State.measurements);
        });
    });

    // Edit measurement handlers
    tbody.querySelectorAll('.edit-meas-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const measId = parseInt(btn.dataset.id);
            const m = State.measurements.find(x => x.id === measId);
            if (m) showMeasurementForm(m);
        });
    });

    tbody.querySelectorAll('.compare-meas-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupKey = btn.dataset.groupKey;
            if (groupKey) addCompareGroup(groupKey);
        });
    });

    // Delete measurement handlers
    tbody.querySelectorAll('.delete-meas-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const measId = parseInt(btn.dataset.id);
            const m = State.measurements.find(x => x.id === measId);
            if (m) confirmDeleteMeasurement(m);
        });
    });
}

function getMeasurementGroupKey(measurement) {
    return [
        measurement.sample_id,
        measurement.device || 'SP64',
        measurement.aging_hours || 0,
    ].join('|');
}

function renderMeasurementRow(measurement, options = {}) {
    const deltaClass = getDeltaClass(measurement.delta_E);
    const deltaText = measurement.delta_E != null ? measurement.delta_E.toFixed(2) : '-';
    const baselineTag = measurement.is_baseline ? ' <span class="baseline-badge">基线</span>' : '';
    const photoCount = options.photoCountOverride != null ? options.photoCountOverride : (measurement.photo_count || 0);
    const photoBadge = photoCount > 0 ? `📷${photoCount}` : '-';
    const toggleHtml = options.toggleHtml ? `<div class="meas-toggle-wrap">${options.toggleHtml}</div>` : '';
    const compareHtml = options.compareHtml || '';

    return `
        <tr class="${options.rowClass || ''}">
            <td>${measurement.aging_hours || 0}h${baselineTag}</td>
            <td>${formatDate(measurement.measurement_date)}</td>
            <td>${escapeHtml(measurement.device || 'SP64')}</td>
            <td>
                <div>${escapeHtml(measurement.angle || '-')}</div>
                ${toggleHtml}
            </td>
            <td>${measurement.L.toFixed(2)}</td>
            <td>${measurement.a.toFixed(2)}</td>
            <td>${measurement.b.toFixed(2)}</td>
            <td><span class="delta-badge ${deltaClass}">${deltaText}</span></td>
            <td class="text-muted" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(measurement.notes || '')}">${escapeHtml(measurement.notes || '-')}</td>
            <td>${photoBadge}</td>
            <td>
                <button class="btn btn-outline btn-sm edit-meas-btn" data-id="${measurement.id}">编辑</button>
                ${compareHtml}
                <button class="btn btn-danger btn-sm delete-meas-btn" data-id="${measurement.id}">删除</button>
            </td>
        </tr>
    `;
}

const MT12_ANGLES = ['r45as-15', 'r45as15', 'r45as25', 'r45as45', 'r45as75', 'r45as110'];

function getCompareGroups() {
    const grouped = new Map();

    (State.measurements || []).forEach(measurement => {
        if ((measurement.device || 'SP64') !== 'MT12') {
            return;
        }
        const groupKey = getMeasurementGroupKey(measurement);
        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, []);
        }
        grouped.get(groupKey).push(measurement);
    });

    return grouped;
}

function buildCompareGroupMeta(groupMeasurements) {
    const sample = State.samples.find(item => item.id === State.selectedSampleId);
    const representative = groupMeasurements.find(item => item.angle === 'r45as45') || groupMeasurements[0];
    const sampleName = sample?.name || '当前样品';
    const sampleCode = sample?.code || '-';
    const device = representative?.device || 'MT12';
    const agingHours = representative?.aging_hours || 0;
    return {
        key: representative ? getMeasurementGroupKey(representative) : '',
        label: `${sampleName} / ${sampleCode} / ${device} / ${agingHours}h`,
        sampleName,
        sampleCode,
        device,
        agingHours,
        measurementDate: representative?.measurement_date || '',
        notes: representative?.notes || '',
        angleCount: groupMeasurements.length,
        measurements: [...groupMeasurements].sort((left, right) => {
            const leftIndex = MT12_ANGLES.indexOf(left.angle || '');
            const rightIndex = MT12_ANGLES.indexOf(right.angle || '');
            return leftIndex - rightIndex;
        }),
    };
}

function getCompareSelectionKeys() {
    return State.compareSelections.map(item => item.key);
}

function isCompleteCompareGroup(groupMeasurements) {
    const angleSet = new Set((groupMeasurements || []).map(item => item.angle || ''));
    return MT12_ANGLES.every(angle => angleSet.has(angle));
}

function getCompareSelection() {
    return [...State.compareSelections];
}

function renderCompareButton(groupMeasurements, measurement = null) {
    const device = measurement?.device || groupMeasurements?.[0]?.device || 'SP64';
    const selectionKeys = getCompareSelectionKeys();
    if (device !== 'MT12') {
        return '<button class="btn btn-outline btn-sm compare-meas-btn" disabled>仅MT12</button>';
    }

    if (!Array.isArray(groupMeasurements) || groupMeasurements.length === 0) {
        return '<button class="btn btn-outline btn-sm compare-meas-btn" disabled>角度不足</button>';
    }

    const groupKey = getMeasurementGroupKey(groupMeasurements[0]);
    const isComplete = isCompleteCompareGroup(groupMeasurements);
    const isSelected = selectionKeys.includes(groupKey);
    const isDisabled = !isComplete || (!isSelected && State.compareSelections.length >= 3);
    const className = isSelected ? 'btn btn-primary btn-sm compare-meas-btn is-selected' : 'btn btn-outline btn-sm compare-meas-btn';
    const disabledAttr = isDisabled ? 'disabled' : '';
    const label = !isComplete ? '角度不足' : (isSelected ? '已对比' : '对比');

    return `<button class="${className}" data-group-key="${escapeHtml(groupKey)}" ${disabledAttr}>${label}</button>`;
}

function addCompareGroup(groupKey) {
    if (!groupKey) {
        return;
    }

    if (getCompareSelectionKeys().includes(groupKey)) {
        State.currentTab = 'compare';
        activateTab('compare');
        return;
    }

    if (State.compareSelections.length >= 3) {
        showToast('最多只能对比 3 组测量记录', 'error');
        return;
    }

    const grouped = getCompareGroups();
    if (!grouped.has(groupKey)) {
        showToast('该组测量记录不存在', 'error');
        return;
    }

    if (!isCompleteCompareGroup(grouped.get(groupKey))) {
        showToast('仅支持对比完整的 MT12 六角度数据组', 'error');
        return;
    }

    State.compareSelections = [...State.compareSelections, buildCompareGroupMeta(grouped.get(groupKey))];
    renderMeasurementsTab(State.measurements);
    renderComparisonTab();
    State.currentTab = 'compare';
    activateTab('compare');
}

function removeCompareGroup(groupKey) {
    State.compareSelections = State.compareSelections.filter(item => item.key !== groupKey);
    renderMeasurementsTab(State.measurements);
    renderComparisonTab();
}

function clearCompareSelections() {
    State.compareSelections = [];
    renderMeasurementsTab(State.measurements);
    renderComparisonTab();
}

function activateTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabName}"]`)?.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');

    if (tabName === 'charts') {
        for (const id in chartInstances) {
            if (chartInstances[id]) chartInstances[id].resize();
        }
        if (State.measurements && State.measurements.length > 1) {
            setTimeout(() => renderColorBars(State.measurements), 100);
        }
    }

    if (tabName === 'compare') {
        setTimeout(() => resizeCompareCharts(), 100);
    }
}

let compareChartInstances = {};

function destroyCompareCharts() {
    for (const id in compareChartInstances) {
        if (compareChartInstances[id]) {
            compareChartInstances[id].destroy();
            delete compareChartInstances[id];
        }
    }
}

function resizeCompareCharts() {
    for (const id in compareChartInstances) {
        if (compareChartInstances[id]) {
            compareChartInstances[id].resize();
        }
    }
}

function buildCompareDatasets(selection, key) {
    const palette = [
        'rgba(37, 99, 235, 0.72)',
        'rgba(16, 185, 129, 0.72)',
        'rgba(245, 158, 11, 0.72)',
    ];
    const borders = [
        'rgb(37, 99, 235)',
        'rgb(16, 185, 129)',
        'rgb(245, 158, 11)',
    ];

    return selection.map((group, index) => {
        const pointMap = new Map(group.measurements.map(item => [item.angle || '', item]));
        return {
            label: group.label,
            data: MT12_ANGLES.map(angle => pointMap.get(angle)?.[key] ?? null),
            backgroundColor: palette[index % palette.length],
            borderColor: borders[index % borders.length],
            borderWidth: 1.5,
            borderRadius: 4,
        };
    });
}

function renderComparisonTab() {
    const emptyEl = document.getElementById('compareEmpty');
    const contentEl = document.getElementById('compareContent');
    const summaryEl = document.getElementById('compareSummary');
    const recordsGridEl = document.getElementById('compareRecordsGrid');
    const recordsCountEl = document.getElementById('compareRecordsCount');
    const clearBtnEl = document.getElementById('compareClearBtn');

    if (!emptyEl || !contentEl || !summaryEl || !recordsGridEl || !recordsCountEl || !clearBtnEl) {
        return;
    }

    const selection = getCompareSelection();
    destroyCompareCharts();

    if (selection.length === 0) {
        emptyEl.style.display = 'block';
        contentEl.style.display = 'none';
        summaryEl.innerHTML = '';
        recordsGridEl.innerHTML = '';
        recordsCountEl.textContent = '';
        clearBtnEl.style.display = 'none';
        clearBtnEl.onclick = null;
        return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    clearBtnEl.style.display = 'inline-flex';
    clearBtnEl.onclick = () => clearCompareSelections();
    summaryEl.innerHTML = selection.map(group => `
        <div class="compare-summary-item">
            <span class="compare-summary-label">${escapeHtml(group.label)}</span>
            <button type="button" class="compare-summary-remove" data-group-key="${escapeHtml(group.key)}">移除</button>
        </div>
    `).join('');

    summaryEl.querySelectorAll('.compare-summary-remove').forEach(button => {
        button.addEventListener('click', () => removeCompareGroup(button.dataset.groupKey));
    });

    recordsCountEl.textContent = `已选择 ${selection.length} / 3 条`;
    recordsGridEl.innerHTML = selection.map(group => `
        <div class="compare-record-card">
            <div class="compare-record-title">${escapeHtml(group.sampleName)} / ${escapeHtml(group.sampleCode)}</div>
            <div class="compare-record-meta">
                <div class="compare-record-item">
                    <label>测量时间</label>
                    <span>${escapeHtml(formatDate(group.measurementDate) || '-')}</span>
                </div>
                <div class="compare-record-item">
                    <label>老化时间</label>
                    <span>${escapeHtml(String(group.agingHours))}h</span>
                </div>
                <div class="compare-record-item">
                    <label>设备</label>
                    <span>${escapeHtml(group.device || '-')}</span>
                </div>
                <div class="compare-record-item">
                    <label>角度数</label>
                    <span>${escapeHtml(String(group.angleCount))} / 6</span>
                </div>
                <div class="compare-record-item">
                    <label>角度范围</label>
                    <span>${escapeHtml(group.measurements.map(item => item.angle || '-').join(', '))}</span>
                </div>
                <div class="compare-record-item">
                    <label>备注</label>
                    <span title="${escapeHtml(group.notes || '')}">${escapeHtml(group.notes || '-')}</span>
                </div>
            </div>
        </div>
    `).join('');

    const chartConfigs = [
        { canvasId: 'compareChartL', key: 'L', title: 'L* 数据对比', yLabel: 'L*' },
        { canvasId: 'compareChartA', key: 'a', title: 'a* 数据对比', yLabel: 'a*' },
        { canvasId: 'compareChartB', key: 'b', title: 'b* 数据对比', yLabel: 'b*' },
    ];

    chartConfigs.forEach(({ canvasId, key, title, yLabel }) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            return;
        }
        compareChartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: MT12_ANGLES,
                datasets: buildCompareDatasets(selection, key),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: title,
                        font: { size: 13 },
                    },
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '角度',
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: yLabel,
                        },
                    },
                },
            },
        });
    });
}

function showMeasurementForm(existingMeasurement = null) {
    const isEdit = existingMeasurement != null;
    const m = existingMeasurement || {};
    const dateValue = m.measurement_date
        ? toLocalDateTimeInput(m.measurement_date)
        : toLocalDateTimeInput(new Date().toISOString());
    const currentDevice = m.device || 'SP64';

    const bodyHtml = `
        <div class="form-row">
            <div class="form-group">
                <label>老化时间(小时) <span class="required">*</span></label>
                <input type="number" id="measAgingHours" class="form-input" step="0.1" min="0" value="${m.aging_hours != null ? m.aging_hours : '0'}" placeholder="0=基线">
            </div>
            <div class="form-group">
                <label>测量日期</label>
                <input type="datetime-local" id="measDate" class="form-input" value="${dateValue}">
            </div>
            <div class="form-group">
                <label>测试设备 <span class="required">*</span></label>
                <select id="measDevice" class="form-input" ${isEdit ? 'disabled' : ''}>
                    <option value="SP64" ${currentDevice === 'SP64' ? 'selected' : ''}>SP64</option>
                    <option value="MT12" ${currentDevice === 'MT12' ? 'selected' : ''}>MT12</option>
                </select>
            </div>
        </div>
        <div id="measRows">
            ${renderMeasRows(currentDevice, m)}
        </div>
        <div class="form-group">
            <label>备注</label>
            <textarea id="measNotes" class="form-input" placeholder="可选备注">${escapeHtml(m.notes || '')}</textarea>
        </div>
    `;

    showModal(
        isEdit ? '编辑测量记录' : '添加测量记录',
        bodyHtml,
        async () => {
            const dateStr = document.getElementById('measDate').value;
            const device = document.getElementById('measDevice').value;
            const agingHours = parseFloat(document.getElementById('measAgingHours').value) || 0;
            const notes = document.getElementById('measNotes').value;
            const parsedDate = parseDateTimeInput(dateStr);

            if (device === 'MT12' && !isEdit) {
                // Batch create 6 measurements
                const entries = [];
                for (const angle of MT12_ANGLES) {
                    const L = parseFloat(document.getElementById(`measL_${angle}`).value);
                    const a = parseFloat(document.getElementById(`measA_${angle}`).value);
                    const b = parseFloat(document.getElementById(`measB_${angle}`).value);
                    if (isNaN(L) || isNaN(a) || isNaN(b)) {
                        throw new Error(`请填写角度 ${angle} 的完整 L*, a*, b* 数值`);
                    }
                    if (L < 0 || L > 200) throw new Error(`角度 ${angle}: L* 值必须在 0-200 之间`);
                    entries.push({ angle, L, a, b });
                }
                const batchData = { device, aging_hours: agingHours, entries };
                if (parsedDate) batchData.measurement_date = parsedDate;
                const res = await fetch(`/api/samples/${State.selectedSampleId}/measurements/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(batchData),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: '请求失败' }));
                    throw new Error(err.detail || '请求失败');
                }
                showToast('MT12 6个角度测量已添加', 'success');
            } else {
                // Single measurement (SP64 or edit)
                const L = parseFloat(document.getElementById('measL').value);
                const a = parseFloat(document.getElementById('measA').value);
                const b = parseFloat(document.getElementById('measB').value);
                if (isNaN(L) || isNaN(a) || isNaN(b)) throw new Error('请填写完整的 L*, a*, b* 数值');
                if (L < 0 || L > 200) throw new Error('L* 值必须在 0-200 之间');

                const angleEl = document.getElementById('measAngle');
                const data = { L, a, b, aging_hours: agingHours, notes, device };
                if (angleEl) data.angle = angleEl.value || null;
                if (parsedDate) data.measurement_date = parsedDate;

                if (isEdit) {
                    await API.updateMeasurement(m.id, data);
                    showToast('测量记录已更新', 'success');
                } else {
                    await API.createMeasurement(State.selectedSampleId, data);
                    showToast('测量记录已添加', 'success');
                }
            }
            await refreshDetailView();
        },
        isEdit ? '保存' : '添加'
    );

    // Device change handler (only for new measurements)
    if (!isEdit) {
        setTimeout(() => {
            const deviceSel = document.getElementById('measDevice');
            if (deviceSel) {
                deviceSel.addEventListener('change', () => {
                    document.getElementById('measRows').innerHTML = renderMeasRows(deviceSel.value, {});
                });
            }
        }, 50);
    }
}

function renderMeasRows(device, m) {
    if (device === 'MT12') {
        return MT12_ANGLES.map(angle => `
            <div class="form-row" style="align-items:center; margin-bottom:4px;">
                <div class="form-group" style="flex:0 0 80px;">
                    <label style="font-size:12px;color:var(--primary);font-weight:700;">${angle}</label>
                </div>
                <div class="form-group" style="flex:1;">
                    <input type="number" id="measL_${angle}" class="form-input" step="0.01" min="0" max="100" placeholder="L*" value="">
                </div>
                <div class="form-group" style="flex:1;">
                    <input type="number" id="measA_${angle}" class="form-input" step="0.01" placeholder="a*" value="">
                </div>
                <div class="form-group" style="flex:1;">
                    <input type="number" id="measB_${angle}" class="form-input" step="0.01" placeholder="b*" value="">
                </div>
            </div>
        `).join('');
    } else {
        // SP64 - single row, optional angle
        return `
            <div class="form-row">
                <div class="form-group" style="flex:0 0 100px;">
                    <label>角度</label>
                    <input type="text" id="measAngle" class="form-input" value="${escapeHtml(m.angle || '')}" placeholder="可选">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>L* <span class="required">*</span></label>
                    <input type="number" id="measL" class="form-input" step="0.01" min="0" max="100" value="${m.L != null ? m.L : ''}" placeholder="0-100">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>a* <span class="required">*</span></label>
                    <input type="number" id="measA" class="form-input" step="0.01" value="${m.a != null ? m.a : ''}" placeholder="例如: -10.5">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>b* <span class="required">*</span></label>
                    <input type="number" id="measB" class="form-input" step="0.01" value="${m.b != null ? m.b : ''}" placeholder="例如: 20.3">
                </div>
            </div>
        `;
    }
}

async function confirmDeleteMeasurement(m) {
    const dateStr = formatDate(m.measurement_date);
    showModal(
        '确认删除',
        `<p>确定要删除 <span class="highlight">${dateStr}</span> 的测量记录吗？</p>
         <p class="text-muted">L*=${m.L.toFixed(2)}, a*=${m.a.toFixed(2)}, b*=${m.b.toFixed(2)}</p>
         ${m.is_baseline ? '<p class="text-muted" style="color:#dc2626;">⚠ 这是基线测量，删除后将重新计算其他测量的 ΔE</p>' : ''}`,
        async () => {
            await API.deleteMeasurement(m.id);
            showToast('测量记录已删除', 'success');
            await refreshDetailView();
        },
        '删除',
        true
    );
}

// ============================================================
// Photos Tab
// ============================================================
function renderPhotosTab(photos) {
    const gallery = document.getElementById('photoGallery');
    const empty = document.getElementById('photosEmpty');

    if (photos.length === 0) {
        gallery.innerHTML = '';
        gallery.appendChild(empty);
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';
    gallery.innerHTML = photos.map(p => `
        <div class="photo-card" data-id="${p.id}">
            <img src="/api/photos/${p.id}/file" alt="${escapeHtml(p.original_name)}" loading="lazy">
            <button class="photo-card-delete" data-id="${p.id}" title="删除照片">&times;</button>
            <div class="photo-card-overlay">
                <div class="photo-card-name">${escapeHtml(p.original_name)}</div>
            </div>
        </div>
    `).join('');

    // Click to view full size
    gallery.querySelectorAll('.photo-card img').forEach(img => {
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = img.closest('.photo-card');
            const photo = photos.find(p => p.id === parseInt(card.dataset.id));
            if (photo) {
                showLightbox(
                    `/api/photos/${photo.id}/file`,
                    `${escapeHtml(photo.original_name)} - ${formatDate(photo.upload_date)}`
                );
            }
        });
    });

    // Delete button
    gallery.querySelectorAll('.photo-card-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const photoId = parseInt(btn.dataset.id);
            const photo = photos.find(p => p.id === photoId);
            if (photo) confirmDeletePhoto(photo);
        });
    });
}

async function confirmDeletePhoto(photo) {
    showModal(
        '确认删除',
        `<p>确定要删除照片 <span class="highlight">${escapeHtml(photo.original_name)}</span> 吗？</p>`,
        async () => {
            await API.deletePhoto(photo.id);
            showToast('照片已删除', 'success');
            await refreshDetailView();
        },
        '删除',
        true
    );
}

// ============================================================
// Charts Tab
// ============================================================
let chartInstances = {};  // { 'chartL': Chart, 'chartA': Chart, ... }

const chartLegendMap = {
    chartL: 'chartLLegend',
    chartA: 'chartALegend',
    chartB: 'chartBLegend',
    chartDeltaE: 'chartDeltaELegend',
};

function extractDatasetAngle(label = '') {
    const match = String(label).match(/r45as-?\d+/i);
    return match ? match[0] : '';
}

function getAvailableChartAngles(chartData) {
    const datasets = chartData?.charts?.delta_E?.datasets || [];
    return [...new Set(datasets.map(dataset => extractDatasetAngle(dataset.label)).filter(Boolean))];
}

function getActiveChartAngles(chartData) {
    const availableAngles = getAvailableChartAngles(chartData);
    if (availableAngles.length === 0) {
        return [];
    }

    const selectedAngles = Array.isArray(State.selectedChartAngles)
        ? State.selectedChartAngles.filter(angle => availableAngles.includes(angle))
        : [];

    if (selectedAngles.length > 0) {
        return selectedAngles;
    }

    State.selectedChartAngles = [...availableAngles];
    return [...availableAngles];
}

function filterChartDatasets(datasets, activeAngles) {
    return (datasets || []).filter(dataset => {
        const angle = extractDatasetAngle(dataset.label);
        if (!angle) {
            return true;
        }
        return activeAngles.includes(angle);
    });
}

function renderChartAngleControls(chartData) {
    const container = document.getElementById('chartAngleControls');
    if (!container) return;

    const availableAngles = getAvailableChartAngles(chartData);
    if (availableAngles.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    const activeAngles = getActiveChartAngles(chartData);
    container.style.display = 'flex';
    container.innerHTML = `
        <div class="chart-angle-filter-label">显示角度</div>
        <div class="chart-angle-filter-options">
            <button type="button" class="chart-angle-action" id="chartAngleSelectAllBtn">全选</button>
            <button type="button" class="chart-angle-action" id="chartAnglePrimaryBtn">仅 r45as45</button>
            ${availableAngles.map(angle => `
                <label class="chart-angle-pill ${activeAngles.includes(angle) ? 'active' : ''}">
                    <input type="checkbox" class="chart-angle-option" value="${escapeHtml(angle)}" ${activeAngles.includes(angle) ? 'checked' : ''}>
                    <span>${escapeHtml(angle)}</span>
                </label>
            `).join('')}
        </div>
    `;

    const optionCheckboxes = Array.from(container.querySelectorAll('.chart-angle-option'));

    document.getElementById('chartAngleSelectAllBtn')?.addEventListener('click', () => {
        State.selectedChartAngles = [...availableAngles];
        renderChartsTab(State.chartDataCache || chartData);
    });

    document.getElementById('chartAnglePrimaryBtn')?.addEventListener('click', () => {
        State.selectedChartAngles = availableAngles.includes('r45as45') ? ['r45as45'] : [availableAngles[0]];
        renderChartsTab(State.chartDataCache || chartData);
    });

    optionCheckboxes.forEach(input => {
        input.addEventListener('change', () => {
            const checkedAngles = optionCheckboxes
                .filter(option => option.checked)
                .map(option => option.value);
            State.selectedChartAngles = checkedAngles.length > 0 ? checkedAngles : [input.value];
            renderChartsTab(State.chartDataCache || chartData);
        });
    });
}

function styleChartDatasets(datasets) {
    return (datasets || []).map(dataset => {
        const label = dataset.label || '';
        const isPrimaryAngle = label.includes('r45as45');
        const hasAngle = label.includes('r45as');
        return {
            ...dataset,
            borderWidth: isPrimaryAngle || !hasAngle ? 2.5 : 0.9,
            borderDash: hasAngle && !isPrimaryAngle ? [5, 4] : [],
            pointRadius: isPrimaryAngle || !hasAngle ? 3 : 1.5,
            pointHoverRadius: isPrimaryAngle || !hasAngle ? 4 : 2,
        };
    });
}

function renderChartsTab(chartData) {
    const chartEmpty = document.getElementById('chartEmpty');
    const chartsContent = document.getElementById('chartsContent');

    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        chartEmpty.style.display = 'block';
        chartsContent.style.display = 'none';
        destroyAllCharts();
        return;
    }

    chartEmpty.style.display = 'none';
    chartsContent.style.display = 'block';
    destroyAllCharts();

    // Set sample name above charts
    const sampleName = State.samples.find(s => s.id === State.selectedSampleId);
    document.getElementById('chartSampleName').textContent = sampleName ? sampleName.name : '';
    renderChartAngleControls(chartData);
    const activeAngles = getActiveChartAngles(chartData);

    // Draw L*, a*, b* charts
    const labKeys = [
        { key: 'L', canvasId: 'chartL' },
        { key: 'a', canvasId: 'chartA' },
        { key: 'b', canvasId: 'chartB' },
    ];

    for (const { key, canvasId } of labKeys) {
        const chartInfo = chartData.charts[key];
        if (!chartInfo) continue;

        const datasets = styleChartDatasets(filterChartDatasets(chartInfo.datasets || [], activeAngles));

        if (datasets.length === 0) continue;

        const ctx = document.getElementById(canvasId).getContext('2d');
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels: chartData.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    title: { display: true, text: chartInfo.title, font: { size: 13 } },
                    legend: { display: false },
                },
                scales: {
                    x: { title: { display: false } },
                    y: { title: { display: true, text: chartInfo.yLabel } },
                },
            },
        });
        renderExternalLegend(canvasId, datasets);
    }

    // Draw delta_E chart (full width)
    const deInfo = chartData.charts['delta_E'];
    if (deInfo && deInfo.datasets && deInfo.datasets.length > 0) {
        const datasets = styleChartDatasets(filterChartDatasets(deInfo.datasets, activeAngles));
        const deCtx = document.getElementById('chartDeltaE').getContext('2d');
        chartInstances['chartDeltaE'] = new Chart(deCtx, {
            type: 'line',
            data: { labels: chartData.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    title: { display: true, text: deInfo.title, font: { size: 13 } },
                    legend: { display: false },
                },
                scales: {
                    x: { title: { display: true, text: '老化时间 (h)' } },
                    y: { title: { display: true, text: deInfo.yLabel } },
                },
            },
        });
        renderExternalLegend('chartDeltaE', datasets);
    }

    // Render multi-angle color changes aligned to the Delta E chart x-axis.
    renderColorBars(State.measurements, chartData.labels || [], activeAngles);
}

function destroyAllCharts() {
    for (const id in chartInstances) {
        if (chartInstances[id]) {
            chartInstances[id].destroy();
            delete chartInstances[id];
        }
    }

    Object.values(chartLegendMap).forEach(legendId => {
        const legend = document.getElementById(legendId);
        if (legend) legend.innerHTML = '';
    });
}

function renderExternalLegend(canvasId, datasets) {
    const legendId = chartLegendMap[canvasId];
    if (!legendId) return;

    const legend = document.getElementById(legendId);
    if (!legend) return;

    legend.innerHTML = '';
}

// ============================================================
// LAB → sRGB Conversion for Color Bar
// ============================================================

function labToRgb(L, a, b) {
    // LAB → XYZ (D65 illuminant)
    let y = (L + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    const xyz = [x, y, z].map(v => {
        const v3 = v * v * v;
        return v3 > 0.008856 ? v3 : (v - 16 / 116) / 7.787;
    });

    const X = xyz[0] * 95.047;
    const Y = xyz[1] * 100.000;
    const Z = xyz[2] * 108.883;

    // XYZ → linear sRGB
    let r = X *  0.032406 + Y * -0.015372 + Z * -0.004986;
    let g = X * -0.009689 + Y *  0.018758 + Z *  0.000415;
    let bl = X *  0.000557 + Y * -0.002040 + Z *  0.010570;

    // Gamma correction
    [r, g, bl] = [r, g, bl].map(v => {
        const absV = Math.abs(v);
        return absV > 0.0031308
            ? (1.055 * Math.pow(absV, 1 / 2.4) - 0.055)
            : 12.92 * v;
    });

    // Clamp to 0-255
    return [
        Math.max(0, Math.min(255, Math.round(r * 255))),
        Math.max(0, Math.min(255, Math.round(g * 255))),
        Math.max(0, Math.min(255, Math.round(bl * 255))),
    ];
}

function renderColorBars(measurements, agingLabels = [], selectedAngles = []) {
    const container = document.getElementById('colorBarsContainer');
    container.innerHTML = '';

    if (!measurements || measurements.length === 0) return;

    const mt12 = measurements.filter(m => {
        if ((m.device || 'SP64') !== 'MT12') return false;
        if (!selectedAngles || selectedAngles.length === 0) return true;
        return selectedAngles.includes(m.angle || '');
    });
    const sp64 = measurements.filter(m => (m.device || 'SP64') !== 'MT12');
    const agingPoints = resolveDisplayAgingPoints(
        agingLabels,
        measurements.map(m => m.aging_hours || 0)
    );

    if (mt12.length > 0) {
        container.appendChild(buildMT12ColorTrends(mt12, agingPoints, selectedAngles));
    }

    if (sp64.length > 0 && mt12.length === 0) {
        container.appendChild(buildSP64ColorTrend(sp64, agingPoints));
    }
}

function resolveDisplayAgingPoints(preferredLabels, fallbackLabels) {
    const labels = Array.isArray(preferredLabels) && preferredLabels.length > 0 ? preferredLabels : fallbackLabels;
    return [...new Set(labels.map(Number))].sort((a, b) => a - b);
}

function buildMT12ColorTrends(mt12Measurements, agingPoints, selectedAngles = []) {
    const mt12ByAngle = {};
    MT12_ANGLES.forEach(angle => {
        mt12ByAngle[angle] = {};
    });
    mt12Measurements.forEach(m => {
        const angle = m.angle || '';
        if (!mt12ByAngle[angle]) mt12ByAngle[angle] = {};
        mt12ByAngle[angle][m.aging_hours || 0] = m;
    });
    const baseAngles = Array.isArray(selectedAngles) && selectedAngles.length > 0
        ? MT12_ANGLES.filter(angle => selectedAngles.includes(angle))
        : [...MT12_ANGLES];
    const primaryAngle = baseAngles.includes('r45as45') ? 'r45as45' : (baseAngles[0] || 'r45as45');
    const orderedAngles = [primaryAngle, ...baseAngles.filter(angle => angle !== primaryAngle)];

    const block = document.createElement('div');
    block.className = 'color-trend-block';
    block.innerHTML = `
        <div class="color-trend-header">
            <div class="color-bar-label">多角度颜色变化趋势</div>
            <button class="btn btn-outline btn-sm" id="toggleColorTrendAnglesBtn">${State.showAllColorTrendAngles ? '收起其他角度' : '展开全部角度'}</button>
        </div>
        <div class="color-trend-list color-trend-list-fixed">
            ${orderedAngles.map(angle => `
                <div class="color-trend-row ${!State.showAllColorTrendAngles && angle !== primaryAngle ? 'color-trend-row-collapsed' : ''}">
                    <div class="color-trend-angle">${escapeHtml(angle)}</div>
                    <div class="color-trend-canvas-wrap">
                        <canvas class="color-trend-canvas" id="colorTrend_${angle}"></canvas>
                        <div class="color-trend-ticks" id="colorTrendTicks_${angle}"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    setTimeout(() => {
        orderedAngles.forEach(angle => {
            drawColorTrendBar(`colorTrend_${angle}`, `colorTrendTicks_${angle}`, mt12ByAngle[angle] || {}, agingPoints);
        });
        const toggleBtn = document.getElementById('toggleColorTrendAnglesBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                State.showAllColorTrendAngles = !State.showAllColorTrendAngles;
                renderColorBars(State.measurements, agingPoints, selectedAngles);
            });
        }
    }, 0);

    return block;
}

function buildSP64ColorTrend(sp64Measurements, agingPoints) {
    const sp64ByAging = {};
    sp64Measurements.forEach(m => {
        sp64ByAging[m.aging_hours || 0] = m;
    });

    const block = document.createElement('div');
    block.className = 'color-trend-block';
    block.innerHTML = `
        <div class="color-trend-header">
            <div class="color-bar-label">SP64 颜色变化趋势</div>
        </div>
        <div class="color-trend-row single-angle">
            <div class="color-trend-angle">SP64</div>
            <div class="color-trend-canvas-wrap">
                <canvas class="color-trend-canvas" id="colorTrend_sp64"></canvas>
                <div class="color-trend-ticks" id="colorTrendTicks_sp64"></div>
            </div>
        </div>
    `;

    setTimeout(() => {
        drawColorTrendBar('colorTrend_sp64', 'colorTrendTicks_sp64', sp64ByAging, agingPoints);
    }, 0);

    return block;
}

function drawColorTrendBar(canvasId, ticksId, measurementsByAging, agingPoints) {
    const canvas = document.getElementById(canvasId);
    const ticksDiv = document.getElementById(ticksId);
    if (!canvas || !ticksDiv || !agingPoints || agingPoints.length === 0) return;

    const deChart = chartInstances['chartDeltaE'];
    let chartAreaWidth = 0;
    if (deChart && deChart.chartArea) {
        chartAreaWidth = deChart.chartArea.width || 0;
    }

    const container = document.getElementById('colorBarsContainer');
    const fallbackWidth = container ? container.clientWidth : 600;
    const width = chartAreaWidth > 50 ? chartAreaWidth : fallbackWidth;
    const leftPad = 0;

    if (width < 50) {
        setTimeout(() => drawColorTrendBar(canvasId, ticksId, measurementsByAging, agingPoints), 120);
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const height = 28;
    const totalW = leftPad + width;
    canvas.width = totalW * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalW, height);

    const colors = agingPoints.map(h => {
        const measurement = measurementsByAging[h];
        if (!measurement) return null;
        const [r, g, b] = labToRgb(measurement.L, measurement.a, measurement.b);
        return `rgb(${r}, ${g}, ${b})`;
    });

    if (agingPoints.length === 1) {
        ctx.fillStyle = colors[0] || '#d1d5db';
        ctx.fillRect(leftPad, 0, width, height);
    } else {
        const segmentWidth = width / (agingPoints.length - 1);
        for (let index = 0; index < agingPoints.length - 1; index += 1) {
            const x = leftPad + index * segmentWidth;
            const gradient = ctx.createLinearGradient(x, 0, x + segmentWidth, 0);
            gradient.addColorStop(0, colors[index] || '#d1d5db');
            gradient.addColorStop(1, colors[index + 1] || '#d1d5db');
            ctx.fillStyle = gradient;
            ctx.fillRect(x, 0, segmentWidth + 1, height);
        }
    }

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.strokeRect(leftPad + 0.5, 0.5, width - 1, height - 1);

    ticksDiv.style.marginLeft = `${leftPad}px`;
    ticksDiv.style.width = `${width}px`;
    ticksDiv.style.justifyContent = agingPoints.length > 1 ? 'space-between' : 'center';
    ticksDiv.innerHTML = agingPoints.map(h => `<span>${h}h</span>`).join('');
}

function drawMT12ColorBar(canvasId, ticksId, mt12ByAging, agingPoints) {
    const canvas = document.getElementById(canvasId);
    const ticksDiv = document.getElementById(ticksId);
    if (!canvas || !ticksDiv) return;

    const angles = MT12_ANGLES;
    const container = document.getElementById('colorBarsContainer');
    let width = container ? container.clientWidth : 0;
    if (width < 50) { setTimeout(() => drawMT12ColorBar(canvasId, ticksId, mt12ByAging, agingPoints), 100); return; }

    const dpr = window.devicePixelRatio || 1;
    const barH = 40;
    const gap = 8;
    const height = agingPoints.length * barH + (agingPoints.length - 1) * gap + 4;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const segW = width / angles.length;

    agingPoints.forEach((h, rowIdx) => {
        const y = rowIdx * (barH + gap);
        const row = mt12ByAging[h];

        angles.forEach((angle, colIdx) => {
            const m = row[angle];
            const x = colIdx * segW;
            if (m) {
                const [r, g, b] = labToRgb(m.L, m.a, m.b);
                ctx.fillStyle = `rgb(${r},${g},${b})`;
            } else {
                ctx.fillStyle = '#ccc';
            }
            ctx.fillRect(x + 1, y + 1, segW - 2, barH - 2);

            // Angle label on first row
            if (rowIdx === 0) {
                ctx.fillStyle = '#fff';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(angle, x + segW / 2, y + barH / 2 + 3);
            }
        });

        // Aging label on left
        ctx.fillStyle = 'var(--text)';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${h}h`, -4, y + barH / 2 + 3);
    });

    // Tick labels = aging times
    ticksDiv.innerHTML = agingPoints.map(h => `<span>${h}h</span>`).join('');
}

function drawSP64ColorBar(canvasId, ticksId, group) {
    const canvas = document.getElementById(canvasId);
    const ticksDiv = document.getElementById(ticksId);
    if (!canvas || !ticksDiv) return;

    // Align width with delta E chart's plot area
    const deChart = chartInstances['chartDeltaE'];
    let chartAreaWidth = 0, chartLeft = 0;
    if (deChart && deChart.scales && deChart.scales.x) {
        chartAreaWidth = deChart.chartArea ? deChart.chartArea.width : 0;
        chartLeft = deChart.chartArea ? deChart.chartArea.left : 0;
    }
    const container = document.getElementById('colorBarsContainer');
    const containerWidth = container ? container.clientWidth : 600;
    let width = chartAreaWidth > 50 ? chartAreaWidth : containerWidth;
    let leftPad = chartLeft > 0 ? chartLeft : 0;
    if (width < 50) {
        setTimeout(() => drawSP64ColorBar(canvasId, ticksId, group), 150);
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const height = 36;
    const totalW = leftPad + width;
    canvas.width = totalW * dpr;
    canvas.height = height * dpr;
    canvas.style.width = totalW + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const n = group.length;
    const segWidth = width / Math.max(n - 1, 1);

    for (let i = 0; i < n - 1; i++) {
        const [r1, g1, b1] = labToRgb(group[i].L, group[i].a, group[i].b);
        const [r2, g2, b2] = labToRgb(group[i + 1].L, group[i + 1].a, group[i + 1].b);
        const xStart = leftPad + i * segWidth;
        const grad = ctx.createLinearGradient(xStart, 0, xStart + segWidth, 0);
        grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
        grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
        ctx.fillStyle = grad;
        ctx.fillRect(xStart, 0, segWidth + 1, height);
    }

    // Show all tick labels spread across full width, aligned with chart
    ticksDiv.innerHTML = group.map(m => `<span>${m.aging_hours || 0}h</span>`).join('');
    ticksDiv.style.display = 'flex';
    ticksDiv.style.justifyContent = 'space-between';
}

// ============================================================
// Sample Form (Create / Edit)
// ============================================================
function showSampleForm(existingSample = null) {
    const isEdit = existingSample != null;
    const s = existingSample || {};

    const bodyHtml = `
        <div class="form-section">
        <div class="form-section-title">Part 1 样品标记</div>
        <div class="form-row">
            <div class="form-group">
                <label>样品名称 <span class="required">*</span></label>
                <input type="text" id="sampleName" class="form-input" value="${escapeHtml(s.name || '')}" placeholder="例如: 红色涂料 A-001">
            </div>
            <div class="form-group">
                <label>样品编号 <span class="required">*</span></label>
                <input type="text" id="sampleCode" class="form-input" value="${escapeHtml(s.code || '')}" placeholder="例如: RED-001">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>类别</label>
                <input type="text" id="sampleCategory" class="form-input" value="${escapeHtml(s.category || '')}" placeholder="例如: 涂料、染料、塑料">
            </div>
            <div class="form-group">
                <label>品牌</label>
                <input type="text" id="sampleBrand" class="form-input" value="${escapeHtml(s.brand || '')}" placeholder="品牌名称">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>型号</label>
                <input type="text" id="sampleModel" class="form-input" value="${escapeHtml(s.model || '')}" placeholder="产品型号">
            </div>
            <div class="form-group">
                <label>颜色</label>
                <input type="text" id="sampleColorName" class="form-input" value="${escapeHtml(s.color_name || '')}" placeholder="颜色描述">
            </div>
        </div>
        <div class="form-group">
            <label>其他</label>
            <textarea id="sampleOtherInfo" class="form-input" placeholder="补充样品标记信息">${escapeHtml(s.other_info || '')}</textarea>
        </div>
        </div>
        <div class="form-section">
        <div class="form-section-title">Part 2 老化标记</div>
        <div class="form-row">
            <div class="form-group">
                <label>老化条件</label>
                <input type="text" id="sampleTestCondition" class="form-input" value="${escapeHtml(s.test_condition || '')}" placeholder="例如: 氙灯老化、QUV 340nm">
            </div>
            <div class="form-group">
                <label>老化时间(小时) <span class="required">*</span></label>
                <input type="text" id="sampleAgingTime" class="form-input" value="${escapeHtml(s.aging_time || '')}" placeholder="例如: 500" required>
                <p class="form-hint">单位：小时，如 500 表示 500 小时</p>
            </div>
        </div>
        <div class="form-group">
            <label>设备信息</label>
            <textarea id="sampleDeviceInfo" class="form-input" placeholder="老化设备、治具、环境等信息">${escapeHtml(s.device_info || '')}</textarea>
        </div>
        </div>
        <div class="form-section">
        <div class="form-section-title">Part 3 测试标记</div>
        <div class="form-row">
            <div class="form-group">
                <label>测试设备</label>
                <input type="text" id="sampleTestDevice" class="form-input" value="${escapeHtml(s.test_device || '')}" placeholder="例如: SP64、MT12">
            </div>
            <div class="form-group">
                <label>测量测试</label>
                <input type="text" id="sampleMeasurementTest" class="form-input" value="${escapeHtml(s.measurement_test || '')}" placeholder="测试项目或测试方法">
            </div>
        </div>
        <div class="form-group">
            <label>描述</label>
            <textarea id="sampleDesc" class="form-input" placeholder="样品描述、材料、工艺等补充信息">${escapeHtml(s.description || '')}</textarea>
        </div>
        </div>
    `;

    showModal(
        isEdit ? '编辑样品' : '新建样品',
        bodyHtml,
        async () => {
            const name = document.getElementById('sampleName').value.trim();
            const code = document.getElementById('sampleCode').value.trim();
            const category = document.getElementById('sampleCategory').value.trim();
            const brand = document.getElementById('sampleBrand').value.trim();
            const model = document.getElementById('sampleModel').value.trim();
            const color_name = document.getElementById('sampleColorName').value.trim();
            const other_info = document.getElementById('sampleOtherInfo').value.trim();
            const test_condition = document.getElementById('sampleTestCondition').value.trim();
            const aging_time = document.getElementById('sampleAgingTime').value.trim();
            const device_info = document.getElementById('sampleDeviceInfo').value.trim();
            const test_device = document.getElementById('sampleTestDevice').value.trim();
            const measurement_test = document.getElementById('sampleMeasurementTest').value.trim();
            const description = document.getElementById('sampleDesc').value.trim();

            if (!name) throw new Error('请输入样品名称');
            if (!code) throw new Error('请输入样品编号');
            if (!aging_time) throw new Error('请输入老化时间(小时)');

            const payload = {
                name, code, category, brand, model, color_name,
                other_info, test_condition, aging_time,
                device_info, test_device, measurement_test, description
            };

            if (isEdit) {
                await API.updateSample(s.id, payload);
                showToast('样品已更新', 'success');
            } else {
                const createdSample = await API.createSample(payload);
                showToast('样品已创建', 'success');
                await refreshSampleList();
                await selectSample(createdSample.id, { downloadMode: 'template' });
                return;
            }
            await refreshSampleList();
            if (isEdit && State.selectedSampleId === s.id) {
                await refreshDetailView();
            }
        },
        isEdit ? '保存' : '创建'
    );
}

// ============================================================
// Confirm Delete Sample
// ============================================================
async function confirmDeleteSample() {
    const sample = await API.getSample(State.selectedSampleId);
    showModal(
        '确认删除',
        `<p>确定要删除样品 <span class="highlight">${escapeHtml(sample.name)}</span> (${escapeHtml(sample.code)}) 吗？</p>
         <p class="text-muted">该操作将同时删除所有 ${sample.measurement_count} 条测量记录和 ${sample.photo_count} 张照片，不可恢复。</p>`,
        async () => {
            await API.deleteSample(State.selectedSampleId);
            State.selectedSampleId = null;
            State.sampleDownloadMode = 'export';
            document.getElementById('detailContainer').style.display = 'none';
            document.getElementById('mainEmpty').style.display = 'flex';
            showToast('样品已删除', 'success');
            await refreshSampleList();
        },
        '删除',
        true
    );
}

// ============================================================
// Upload Photo
// ============================================================
function showUploadPhotoForm() {
    const measurements = State.measurements;
    // For MT12, only show first angle (r45as-15) measurements
    const visibleMeasurements = measurements.filter(m => {
        if ((m.device || 'SP64') !== 'MT12') return true;
        return m.angle === MT12_ANGLES[0];  // Only first angle
    });

    let measOptions = '<option value="">不关联测量</option>';
    measOptions += visibleMeasurements.map(m => {
        const agingStr = `${m.aging_hours || 0}h`;
        const baseline = m.is_baseline ? ' [基线]' : '';
        const angleStr = m.angle ? ` ${m.angle}` : '';
        return `<option value="${m.id}">${agingStr}${baseline}${angleStr} - L:${m.L.toFixed(1)} a:${m.a.toFixed(1)} b:${m.b.toFixed(1)}</option>`;
    }).join('');

    const bodyHtml = `
        <div class="form-group">
            <label>选择照片文件 <span class="required">*</span></label>
            <input type="file" id="photoFile" class="form-input" accept=".jpg,.jpeg,.png,.gif,.webp,.bmp">
            <p class="form-hint">支持 JPG、PNG、GIF、WebP、BMP，最大 10MB</p>
        </div>
        <div class="form-group">
            <label>关联测量记录</label>
            <select id="photoMeasureId" class="form-input">${measOptions}</select>
            <p class="form-hint">可选，将照片关联到特定测量时间点</p>
        </div>
        <div class="form-group">
            <label>备注</label>
            <input type="text" id="photoNotes" class="form-input" placeholder="可选备注">
        </div>
    `;

    showModal(
        '上传照片',
        bodyHtml,
        async () => {
            const fileInput = document.getElementById('photoFile');
            const file = fileInput.files[0];
            if (!file) throw new Error('请选择文件');

            const measIdStr = document.getElementById('photoMeasureId').value;
            const measurementId = measIdStr ? parseInt(measIdStr) : null;
            const notes = document.getElementById('photoNotes').value;

            await API.uploadPhoto(State.selectedSampleId, file, measurementId, notes);
            showToast('照片已上传', 'success');
            await refreshDetailView();
        },
        '上传'
    );
}

// ============================================================
// Drag and Drop Upload
// ============================================================
function initDragDrop() {
    const zone = document.getElementById('uploadZone');

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        for (const file of files) {
            try {
                await API.uploadPhoto(State.selectedSampleId, file, null, '');
            } catch (err) {
                showToast(`上传 ${file.name} 失败: ${err.message}`, 'error');
            }
        }
        showToast(`已上传 ${files.length} 张照片`, 'success');
        await refreshDetailView();
    });

    // Click to upload
    zone.addEventListener('click', () => {
        showUploadPhotoForm();
    });
}

// ============================================================
// Sample List Refresh
// ============================================================
async function refreshSampleList() {
    try {
        State.samples = await API.getSamples();
        applyAgingFilterView();
        if (State.currentView === 'all-samples') {
            renderAllSamplesOverview(getVisibleSamples());
        } else if (State.currentView === 'all-measurements') {
            State.allMeasurements = await API.getAllMeasurements();
            renderAllMeasurementsOverview(getVisibleMeasurements());
        }
    } catch (e) {
        showToast('加载样品列表失败: ' + e.message, 'error');
    }
}

// ============================================================
// Search
// ============================================================
let searchTimer = null;

function initSearch() {
    const input = document.getElementById('searchInput');
    const btn = document.getElementById('searchBtn');

    const doSearch = async () => {
        const q = input.value.trim();
        if (!q) {
            await refreshSampleList();
            return;
        }
        try {
            const result = await API.search(q);
            State.samples = result.samples;
            applyAgingFilterView();
            if (State.currentView === 'all-samples') {
                renderAllSamplesOverview(getVisibleSamples());
            }
        } catch (e) {
            showToast('搜索失败: ' + e.message, 'error');
        }
    };

    btn.addEventListener('click', doSearch);

    // Debounced search on input
    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(doSearch, 300);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(searchTimer);
            doSearch();
        }
    });
}

// ============================================================
// Import
// ============================================================
async function handleImport() {
    // Create a hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls,.csv';

    fileInput.onchange = async () => {
        const file = fileInput.files[0];
        if (!file) return;

        let preview;
        try {
            const previewFormData = new FormData();
            previewFormData.append('file', file);
            const previewRes = await fetch('/api/import/preview', { method: 'POST', body: previewFormData });
            if (!previewRes.ok) {
                let errMsg = `HTTP ${previewRes.status}`;
                try {
                    const errJson = await previewRes.json();
                    errMsg = errJson.detail || errMsg;
                } catch {}
                throw new Error(errMsg);
            }
            preview = await previewRes.json();
        } catch (e) {
            console.error('[Import Preview] Error:', e);
            showToast('读取导入预览失败: ' + (e.message || '未知错误'), 'error');
            return;
        }

        const sampleItems = (preview.samples || []).slice(0, 10).map(sample => (
            `<li>${escapeHtml(sample.name)} (${escapeHtml(sample.code)}) - ${sample.measurement_count} 条记录</li>`
        )).join('');
        const moreSamples = preview.samples.length > 10
            ? `<p class="text-muted">...还有 ${preview.samples.length - 10} 个样品</p>`
            : '';
        const previewErrors = (preview.errors || []).length > 0
            ? `<p class="text-muted">预检查发现 ${(preview.errors || []).length} 行可能会被跳过，正式导入后会显示详情。</p>`
            : '';

        showModal(
            '确认上传数据',
            `<p>确认导入文件 <span class="highlight">${escapeHtml(file.name)}</span> 吗？</p>
             <p>样品数量：<strong>${preview.total_samples || 0}</strong></p>
             <p>待上传测试记录数量：<strong>${preview.total_measurements || 0}</strong></p>
             ${sampleItems ? `<p>样品预览：</p><ul style="font-size:13px;max-height:220px;overflow-y:auto;">${sampleItems}</ul>${moreSamples}` : '<p class="text-muted">未识别到可导入的样品数据。</p>'}
             ${previewErrors}
             <p class="text-muted">确认后将开始解析并写入样品与测量数据。</p>`,
            async () => {
                const fileName = file.name;
                showToast(`正在导入 ${fileName} ...`, 'info');

                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    const res = await fetch('/api/import', { method: 'POST', body: formData });
                    if (!res.ok) {
                        let errMsg = `HTTP ${res.status}`;
                        try {
                            const errJson = await res.json();
                            errMsg = errJson.detail || errMsg;
                        } catch {}
                        console.error(`[Import] Server error (${res.status}):`, errMsg);
                        throw new Error(errMsg);
                    }
                    const result = await res.json();
                    console.log('[Import] Result:', result);

                    let msg = `导入完成：${result.total_samples} 个样品，${result.measurements_created} 条测量`;
                    if (result.samples_created > 0) msg += `（新建 ${result.samples_created} 个样品）`;
                    if (result.errors.length > 0) {
                        msg += `\n⚠ ${result.errors.length} 行数据有问题`;
                        console.warn('Import errors:', result.errors);
                    }
                    showToast(msg, 'success');

                    if (result.errors.length > 0) {
                        const errorList = result.errors.slice(0, 10).map(e => `<li>${escapeHtml(e)}</li>`).join('');
                        const moreMsg = result.errors.length > 10 ? `<p class="text-muted">...还有 ${result.errors.length - 10} 条错误</p>` : '';
                        showModal(
                            '导入结果',
                            `<p><strong>✅ ${result.total_samples} 个样品，${result.measurements_created} 条测量记录</strong></p>
                             ${result.samples_created > 0 ? `<p>新建 ${result.samples_created} 个样品</p>` : ''}
                             ${result.errors.length > 0 ? `<br><p>⚠ 以下行数据被跳过：</p><ul style="font-size:13px;max-height:200px;overflow-y:auto;">${errorList}</ul>${moreMsg}` : ''}`,
                            null,
                            '关闭'
                        );
                    }

                    await refreshSampleList();
                } catch (e) {
                    console.error('[Import] Error:', e);
                    showToast('导入失败: ' + (e.message || '未知错误'), 'error');
                }
            },
            '确认上传'
        );
    };

    fileInput.click();
}

// ============================================================
// Export
// ============================================================
async function handleExport() {
    try {
        showToast('正在导出数据...', 'info');
        const response = await fetch('/api/export');
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: '导出失败' }));
            throw new Error(err.detail || '导出失败');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'color_data_export.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('数据导出成功', 'success');
    } catch (e) {
        showToast('导出失败: ' + e.message, 'error');
    }
}

// ============================================================
// Utility Functions
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr);
        return d.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

// Format a date for datetime-local input (local time, YYYY-MM-DDTHH:MM)
function toLocalDateTimeInput(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) throw new Error('Invalid date');
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
        return '';
    }
}

// Parse a datetime-local input value into an ISO string (safe across browsers)
function parseDateTimeInput(value) {
    if (!value) return null;
    try {
        const [datePart, timePart] = value.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = (timePart || '00:00').split(':').map(Number);
        const d = new Date(year, month - 1, day, hour || 0, minute || 0);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch {
        return null;
    }
}

// ============================================================
// Event Handlers
// ============================================================
function initEventHandlers() {
    const pageBrand = document.querySelector('.page-brand');
    if (pageBrand) {
        const syncPageBrandVisibility = () => {
            const hidden = window.scrollY > 24;
            pageBrand.classList.toggle('is-hidden', hidden);
            pageBrand.style.opacity = hidden ? '0' : '1';
            pageBrand.style.transform = hidden ? 'translateY(-10px)' : 'translateY(0)';
        };
        window.addEventListener('scroll', syncPageBrandVisibility, { passive: true });
        syncPageBrandVisibility();
    }

    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            State.isSidebarCollapsed = !State.isSidebarCollapsed;
            document.body.classList.toggle('sidebar-collapsed', State.isSidebarCollapsed);
            sidebarToggleBtn.innerHTML = State.isSidebarCollapsed ? '&gt;&gt;' : '&lt;&lt;';
            sidebarToggleBtn.setAttribute('aria-label', State.isSidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏');
        });
    }

    // Add Sample button
    document.getElementById('addSampleBtn').addEventListener('click', () => showSampleForm());

    document.getElementById('showAllSamplesBtn')?.addEventListener('click', () => {
        showAllSamplesView();
    });

    document.getElementById('showAllMeasurementsBtn')?.addEventListener('click', () => {
        showAllMeasurementsView();
    });

    document.querySelectorAll('.aging-filter-card').forEach(card => {
        card.addEventListener('click', () => {
            const nextFilter = card.dataset.agingFilter;
            State.activeAgingFilter = State.activeAgingFilter === nextFilter ? null : nextFilter;
            applyAgingFilterView();
        });
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            card.click();
        });
    });

    // Import button
    document.getElementById('importBtn').addEventListener('click', handleImport);

    // Edit Sample button
    document.getElementById('editSampleBtn').addEventListener('click', async () => {
        if (!State.selectedSampleId) { showToast('请先选择样品', 'error'); return; }
        try {
            const sample = await API.getSample(State.selectedSampleId);
            showSampleForm(sample);
        } catch (e) {
            showToast('加载样品信息失败', 'error');
        }
    });

    // Download upload template button
    document.getElementById('downloadTemplateBtn').addEventListener('click', async () => {
        if (!State.selectedSampleId) { showToast('请先选择样品', 'error'); return; }
        try {
            if (State.sampleDownloadMode === 'template') {
                await downloadFile(
                    API.getUploadTemplateUrl(State.selectedSampleId),
                    `upload_data_template_for_sample_${State.selectedSampleId}.csv`
                );
                showToast('数据模板已开始下载', 'success');
            } else {
                await downloadFile(
                    API.getSampleExportUrl(State.selectedSampleId),
                    `sample_${State.selectedSampleId}_data.xlsx`
                );
                showToast('样品数据已开始下载', 'success');
            }
        } catch (e) {
            showToast(`下载失败: ${e.message}`, 'error');
        }
    });

    // Delete Sample button
    document.getElementById('deleteSampleBtn').addEventListener('click', () => {
        if (!State.selectedSampleId) { showToast('请先选择样品', 'error'); return; }
        confirmDeleteSample();
    });

    // Add Measurement button
    document.getElementById('addMeasurementBtn').addEventListener('click', () => {
        if (!State.selectedSampleId) { showToast('请先选择样品', 'error'); return; }
        showMeasurementForm();
    });

    // Upload Photo button
    document.getElementById('uploadPhotoBtn').addEventListener('click', () => {
        if (!State.selectedSampleId) { showToast('请先选择样品', 'error'); return; }
        showUploadPhotoForm();
    });

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            State.currentTab = tabName;
            activateTab(tabName);
        });
    });

    // Init drag & drop
    initDragDrop();

    // Init search
    initSearch();
}

// ============================================================
// Initialize
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    initEventHandlers();
    await refreshSampleList();
    setMainView('empty');
});
