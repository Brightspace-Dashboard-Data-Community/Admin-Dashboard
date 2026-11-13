/**
 * Watermark Adjunct Report
 * Upload CSV with OrgDefinedId and export Username + MDU_Status.
 */

const WATERMARK_MDU_STATUS = 'Adjunct';
const WATERMARK_MODAL_ID = 'watermarkLoadingModal';

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('orgDefinedIdFile');
    const secDivisionFileInput = document.getElementById('secDivisionFile');
    const runBtn = document.getElementById('runWatermarkReportBtn');
    const downloadBtn = document.getElementById('downloadWatermarkCsvBtn');
    const resultsContainer = document.getElementById('watermarkResults');

    let outputRows = [];

    runBtn.addEventListener('click', async () => {
        outputRows = [];
        downloadBtn.style.display = 'none';
        resultsContainer.innerHTML = '';

        const file = fileInput.files?.[0];
        if (!file) {
            alert('Please upload a CSV file first.');
            return;
        }
        const secDivisionFile = secDivisionFileInput.files?.[0];
        if (!secDivisionFile) {
            alert('Please upload the SEC Division CSV file.');
            return;
        }

        runBtn.disabled = true;
        LoadingUtils.showLoadingModal('Preparing report...', WATERMARK_MODAL_ID);

        try {
            LoadingUtils.updateLoadingModal(10, 'Reading CSV file...', WATERMARK_MODAL_ID);
            const text = await file.text();
            const orgDefinedIds = parseOrgDefinedIds(text);

            if (orgDefinedIds.length === 0) {
                throw new Error('No OrgDefinedId values were found in the uploaded CSV.');
            }

            LoadingUtils.updateLoadingModal(20, 'Reading SEC Division CSV...', WATERMARK_MODAL_ID);
            const secDivisionText = await secDivisionFile.text();
            const secDivisionMap = parseSecDivisionMap(secDivisionText);

            LoadingUtils.updateLoadingModal(30, `Processing ${orgDefinedIds.length} ID(s)...`, WATERMARK_MODAL_ID);

            const usernames = await resolveUsernames(orgDefinedIds, (done, total) => {
                const percent = 30 + Math.floor((done / total) * 60);
                LoadingUtils.updateLoadingModal(percent, `Looking up users ${done}/${total}...`, WATERMARK_MODAL_ID);
            });

            outputRows = usernames.map((username, rowIndex) => ({
                Username: username,
                MDU_Status: WATERMARK_MDU_STATUS,
                SEC_DIVISIONS: secDivisionMap.get(orgDefinedIds[rowIndex]) || ''
            }));

            const foundCount = usernames.filter(Boolean).length;
            const missingCount = usernames.length - foundCount;
            const matchedSecDivisionCount = outputRows.filter((row) => row.SEC_DIVISIONS).length;

            resultsContainer.innerHTML = `
                <div style="padding: var(--spacing-md); background-color: var(--surface-color); border-radius: var(--radius-sm); margin-top: var(--spacing-md);">
                    <h3 style="margin-top: 0;">Report Complete</h3>
                    <p style="margin-bottom: 6px;">Input IDs: <strong>${orgDefinedIds.length}</strong></p>
                    <p style="margin-bottom: 6px;">Usernames found: <strong>${foundCount}</strong></p>
                    <p style="margin-bottom: 6px;">SEC_DIVISIONS matched: <strong>${matchedSecDivisionCount}</strong></p>
                    <p style="margin-bottom: 0;">Missing usernames: <strong>${missingCount}</strong> (exported as blank Username)</p>
                </div>
            `;

            downloadBtn.style.display = 'inline-flex';
            LoadingUtils.updateLoadingModal(100, 'Done!', WATERMARK_MODAL_ID);
            setTimeout(() => LoadingUtils.hideLoadingModal(WATERMARK_MODAL_ID), 400);
        } catch (error) {
            LoadingUtils.hideLoadingModal(WATERMARK_MODAL_ID);
            resultsContainer.innerHTML = `
                <div style="padding: var(--spacing-md); background-color: #ffebee; color: #c62828; border-radius: var(--radius-sm); margin-top: var(--spacing-md);">
                    Error: ${error.message}
                </div>
            `;
        } finally {
            runBtn.disabled = false;
        }
    });

    downloadBtn.addEventListener('click', () => {
        if (!outputRows.length) {
            alert('Run the report first.');
            return;
        }

        const csvString = Papa.unparse(outputRows, {
            columns: ['Username', 'MDU_Status', 'SEC_DIVISIONS']
        });
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `watermark-adjunct-report_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
});

function parseOrgDefinedIds(csvText) {
    const parsedWithHeader = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    });

    const fieldName = (parsedWithHeader.meta.fields || []).find((field) =>
        String(field).trim().toLowerCase() === 'orgdefinedid'
    );

    let ids = [];

    if (fieldName) {
        ids = parsedWithHeader.data
            .map((row) => (row?.[fieldName] ?? '').toString().trim())
            .filter(Boolean);
    } else {
        const parsedNoHeader = Papa.parse(csvText, {
            header: false,
            skipEmptyLines: true
        });

        ids = (parsedNoHeader.data || [])
            .map((row) => (Array.isArray(row) ? String(row[0] || '').trim() : ''))
            .filter(Boolean);

        if (ids.length && ids[0].toLowerCase() === 'orgdefinedid') {
            ids.shift();
        }
    }

    return ids;
}

function parseSecDivisionMap(csvText) {
    const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    });
    const fields = parsed.meta.fields || [];
    const secField = fields.find((field) => String(field).trim().toLowerCase() === 'sec_divisions');
    const idField = fields.find((field) => {
        const normalized = String(field).trim().toLowerCase();
        return normalized === 'csf_faculty' || normalized === 'orgdefinedid';
    });

    if (!secField || !idField) {
        throw new Error('SEC Division CSV must include SEC_DIVISIONS and CSF_FACULTY (or OrgDefinedId) headers.');
    }

    const secDivisionMap = new Map();

    for (const row of parsed.data) {
        const orgDefinedId = String(row?.[idField] ?? '').trim();
        const secDivision = String(row?.[secField] ?? '').trim();
        if (!orgDefinedId || !secDivision) continue;
        if (!secDivisionMap.has(orgDefinedId)) {
            secDivisionMap.set(orgDefinedId, secDivision);
        }
    }

    return secDivisionMap;
}

async function resolveUsernames(orgDefinedIds, onProgress) {
    const usernames = new Array(orgDefinedIds.length).fill('');
    const concurrency = 5;
    let index = 0;
    let completed = 0;

    async function worker() {
        while (index < orgDefinedIds.length) {
            const currentIndex = index++;
            const orgDefinedId = orgDefinedIds[currentIndex];

            try {
                const response = await D2LApi._fetch(`/d2l/api/lp/1.46/users/?orgDefinedId=${encodeURIComponent(orgDefinedId)}`);
                const user = Array.isArray(response) ? response[0] : response;
                usernames[currentIndex] = user?.UserName || '';
            } catch (error) {
                usernames[currentIndex] = '';
            } finally {
                completed += 1;
                onProgress(completed, orgDefinedIds.length);
            }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, orgDefinedIds.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return usernames;
}
