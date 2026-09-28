/**
 * Bulk Auditor Management
 * CSV of student OrgDefinedIds + one auditor OrgDefinedId + Create/Remove action.
 * https://docs.valence.desire2learn.com/res/enroll.html
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('bulk-auditor-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('auditorCsvFile');
    const auditorOrgDefinedId = document.getElementById('auditorOrgDefinedId').value.trim();
    const action = document.getElementById('auditorAction').value;

    if (!fileInput.files.length) {
      alert('Please upload a CSV file.');
      return;
    }

    if (!auditorOrgDefinedId) {
      alert('Please enter the auditor OrgDefinedId.');
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function (event) {
      const students = parseStudentIds(event.target.result);
      console.log(`📄 Processing ${students.length} students...`);

      if (!students.length) {
        alert('No student OrgDefinedIds found in the CSV.');
        return;
      }

      const report = [];

      try {
        const auditorRes = await BrightspaceFetch('/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(auditorOrgDefinedId));
        const auditorId = auditorRes[0]?.UserId;

        if (!auditorId) {
          alert('Auditor not found for OrgDefinedId: ' + auditorOrgDefinedId);
          return;
        }

        for (const id of students) {
          console.log(`🔍 Looking up student: ${id}`);

          try {
            const res = await BrightspaceFetch('/d2l/api/lp/1.46/users/?orgDefinedId=' + encodeURIComponent(id));
            const userId = res[0]?.UserId;

            if (!userId) {
              console.warn(`⚠️ Student not found: ${id}`);
              report.push({ id, result: 'Student not found' });
              continue;
            }

            if (Number(userId) === Number(auditorId)) {
              report.push({ id, result: 'Cannot audit self' });
              continue;
            }

            const url = '/d2l/api/le/1.75/auditing/auditors/' + encodeURIComponent(auditorId) + '/auditees/';

            if (action === 'CREATE') {
              await auditorWrite(url, 'POST', Number(userId));
              console.log(`✅ Assigned auditor to ${id}`);
              report.push({ id, result: 'Created' });
            } else {
              await auditorWrite(url, 'DELETE', Number(userId));
              console.log(`✅ Removed auditor from ${id}`);
              report.push({ id, result: 'Removed' });
            }
          } catch (err) {
            console.error(`❌ Error processing ${id}:`, err);
            report.push({ id, result: auditorErrorMessage(err) });
          }
        }
      } catch (err) {
        console.error('❌ Auditor lookup failed:', err);
        alert('Could not look up the auditor. Check the OrgDefinedId and try again.');
        return;
      }

      console.table(report);
      window.auditorReport = report;

      const ok = report.filter(r => r.result === 'Created' || r.result === 'Removed').length;
      alert('Bulk auditor management complete. ' + ok + ' of ' + report.length + ' succeeded. Check console for the full report.');
    };

    reader.readAsText(file);
  });

  const downloadReportBtn = document.getElementById('downloadAuditorReportBtn');
  if (downloadReportBtn) {
    downloadReportBtn.addEventListener('click', () => {
      if (!window.auditorReport || !window.auditorReport.length) {
        alert('No report data available.');
        return;
      }
      downloadCSV(window.auditorReport);
    });
  }
});

function parseStudentIds(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(l => l.trim());
  const ids = [];
  const headerLike = new Set(['orgdefinedid', 'org defined id', 'org_defined_id', 'student', 'studentid', 'student id', 'id']);

  lines.forEach((line, index) => {
    const id = line.split(',')[0].replace(/"/g, '').trim();
    if (!id) return;
    if (index === 0 && headerLike.has(id.toLowerCase())) return;
    ids.push(id);
  });

  return ids;
}

function auditorWrite(endpoint, method, auditeeId) {
  return fetch(endpoint, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': localStorage.getItem('XSRF.Token')
    },
    body: JSON.stringify(auditeeId)
  }).then(function (res) {
    if (!res.ok) throw new Error('Fetch failed: ' + endpoint + ' (' + res.status + ')');
    return null;
  });
}

function auditorErrorMessage(err) {
  const message = String(err && err.message ? err.message : err);
  if (message.includes('403')) return '403 – Permission Denied';
  if (message.includes('404')) return '404 – Not Found';
  if (message.includes('400')) return '400 – Invalid request';
  if (message.includes('429')) return '429 – Rate limited';
  return 'Error';
}
