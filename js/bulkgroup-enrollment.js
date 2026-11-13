document.addEventListener('DOMContentLoaded', () => {
  const courseInput = document.getElementById('groupCourseId');
  const groupSelector = document.getElementById('groupSelector');
  const loadGroupsBtn = document.getElementById('loadGroupsBtn');

  async function loadGroups() {
    const orgUnitId = courseInput.value.trim();
    if (!orgUnitId) {
      groupSelector.innerHTML = '<option value="">Enter a Course OrgUnitId first</option>';
      return;
    }

    groupSelector.innerHTML = '<option>Loading...</option>';

    try {
      const categories = await BrightspaceFetch(`/d2l/api/lp/1.51/${orgUnitId}/groupcategories/`);
      let groupOptions = [];

      for (const cat of categories) {
        const groups = await BrightspaceFetch(`/d2l/api/lp/1.51/${orgUnitId}/groupcategories/${cat.GroupCategoryId}/groups/`);
        for (const group of groups) {
          groupOptions.push(`<option value="${group.GroupId}|${cat.GroupCategoryId}">${cat.Name} → ${group.Name}</option>`);
        }
      }

      groupSelector.innerHTML = groupOptions.length ? groupOptions.join("") : "<option>No groups found</option>";
    } catch (err) {
      groupSelector.innerHTML = "<option>Error loading groups</option>";
      console.error("❌ Error fetching group categories or groups:", err);
    }
  }

  courseInput.addEventListener('change', loadGroups);

  if (loadGroupsBtn) {
    loadGroupsBtn.addEventListener('click', loadGroups);
  }

  document.getElementById('batch-group-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('groupCsv');
    const idType = document.getElementById('groupIdType').value;
    const orgUnitId = courseInput.value.trim();
    const [groupId, groupCategoryId] = groupSelector.value.split('|');

    if (!fileInput.files.length || !groupId || !groupCategoryId) {
      return alert("Please upload a CSV and select a group.");
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function (event) {
      const lines = event.target.result.trim().split('\n').map(l => l.trim());
      const report = [];

      for (const line of lines) {
        const id = line.replace(/"/g, '').trim();
        if (!id) continue;

        try {
          let userId = null;

          if (idType === "orgDefinedId") {
            const res = await BrightspaceFetch("/d2l/api/lp/1.51/users/?orgDefinedId=" + encodeURIComponent(id));
            userId = res[0]?.UserId;
          } else {
            const res = await BrightspaceFetch("/d2l/api/lp/1.51/users/?userName=" + encodeURIComponent(id));
            userId = res?.UserId;
          }

          if (!userId) {
            report.push({ id, result: "User not found" });
            continue;
          }

          await BrightspaceFetch(
            `/d2l/api/lp/1.51/${orgUnitId}/groupcategories/${groupCategoryId}/groups/${groupId}/enrollments/`,
            "POST",
            { UserId: userId }
          );

          report.push({ id, result: "Added to group" });
        } catch (err) {
          console.error(`❌ Error adding ${id}:`, err);
          report.push({ id, result: "Error" });
        }
      }

      console.table(report);
      window.groupReport = report;

      const downloadBtn = document.createElement("button");
      downloadBtn.textContent = "Download Report";
      downloadBtn.style.marginTop = "10px";
      downloadBtn.className = "btn btn-primary";
      downloadBtn.type = "button";
      downloadBtn.addEventListener("click", () => downloadCSV(report));
      document.getElementById("batch-group-form").appendChild(downloadBtn);

      alert("✅ Group assignment complete. Check console for report.");
    };

    reader.readAsText(file);
  });
});

function downloadCSV(reportArray) {
  if (!reportArray.length) return;
  const headers = Object.keys(reportArray[0]);
  const csv = [
    headers.join(","),
    ...reportArray.map(row => headers.map(field => JSON.stringify(row[field] ?? "")).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Enrollment_Report.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

var downloadGroupReportBtn = document.getElementById('downloadGroupReportBtn');
if (downloadGroupReportBtn) {
  downloadGroupReportBtn.addEventListener('click', () => {
    if (!window.groupReport || !window.groupReport.length) {
      alert("No report data available.");
      return;
    }
    const headers = Object.keys(window.groupReport[0]);
    const rows = window.groupReport.map(obj => headers.map(h => JSON.stringify(obj[h] ?? "")));
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "bulk_group_report.csv";
    link.click();
  });
}
