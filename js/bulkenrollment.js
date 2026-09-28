document.addEventListener('DOMContentLoaded', () => {
  console.log("✅ Bulk Enrollment Page Ready");

  document.getElementById('batch-enrollment-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('csvFile');
    const idType = document.getElementById('idType').value;
    const roleId = parseInt(document.getElementById('roleId').value);
    const orgUnitId = parseInt(document.getElementById('courseId').value);
    const sendEmail = document.getElementById('sendEmail').checked;

    if (!fileInput.files.length) {
      alert("Please upload a CSV file.");
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function (event) {
      const lines = event.target.result.trim().split('\n').map(l => l.trim());
      console.log(`📄 Processing ${lines.length} rows...`);

      const report = [];

      for (const line of lines) {
        const id = line.replace(/"/g, '').trim();
        if (!id) continue;

        console.log(`🔍 Looking up user by ${idType}: ${id}`);

        try {
          let userId = null;

          if (idType === "orgDefinedId") {
            const res = await BrightspaceFetch("/d2l/api/lp/1.43/users/?orgDefinedId=" + encodeURIComponent(id));
            userId = res[0]?.UserId;
          } else {
            const res = await BrightspaceFetch("/d2l/api/lp/1.46/users/?userName=" + encodeURIComponent(id));
            userId = res?.UserId;
          }

          if (!userId) {
            console.warn(`⚠️ User not found for ${id}`);
            report.push({ id, result: "User not found" });
            continue;
          }

          const payload = {
            OrgUnitId: orgUnitId,
            UserId: userId,
            RoleId: roleId,
            IsActive: true,
            SendEnrollmentEmail: sendEmail
          };

          console.log("📦 Final payload:", payload);

          await BrightspaceFetch("/d2l/api/lp/1.43/enrollments/", "POST", payload);

          console.log(`✅ Successfully enrolled ${id}`);
          report.push({ id, result: "Enrolled" });

        } catch (err) {
          if (err.message.includes("403")) {
            console.error(`❌ Permission denied. You may not have access to assign RoleId ${roleId} in OrgUnit ${orgUnitId}.`);
            report.push({ id, result: "403 – Permission Denied" });
          } else {
            console.error(`❌ Error enrolling ${id}:`, err);
            report.push({ id, result: "Error" });
          }
        }
      }

      console.table(report);
      window.batchReport = report;

      const downloadBtn = document.createElement("button");
      downloadBtn.textContent = "Download Report";
      downloadBtn.style.marginTop = "10px";
      downloadBtn.className = "btn btn-primary";
      downloadBtn.type = "button";
      downloadBtn.addEventListener("click", () => downloadCSV(report));
      document.getElementById("batch-enrollment-form").appendChild(downloadBtn);

      alert("✅ Bulk enrollment complete. Check console for full report.");
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

document.addEventListener('DOMContentLoaded', () => {
  const downloadReportBtn = document.getElementById('downloadReportBtn');
  if (downloadReportBtn) {
    downloadReportBtn.addEventListener('click', () => {
      if (!window.batchReport || !window.batchReport.length) {
        alert("No report data available.");
        return;
      }
      const headers = Object.keys(window.batchReport[0]);
      const rows = window.batchReport.map(obj => headers.map(h => JSON.stringify(obj[h] ?? "")));
      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "bulk-enrollment-report.csv";
      link.click();
    });
  }
});
