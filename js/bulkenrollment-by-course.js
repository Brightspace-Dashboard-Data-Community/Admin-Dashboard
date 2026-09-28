document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('enrollment-by-course-form');

  form?.addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('csvCourseFile');
    const idType = document.getElementById('csvCourseIdType').value;
    const roleId = parseInt(document.getElementById('csvCourseRole').value);
    const sendEmail = document.getElementById('csvCourseSendEmail').checked;

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
        const [id, orgUnitIdRaw] = line.split(',').map(s => s.trim().replace(/"/g, ''));
        const orgUnitId = parseInt(orgUnitIdRaw);

        if (!id || isNaN(orgUnitId)) {
          console.warn(`⚠️ Skipping invalid row: ${line}`);
          report.push({ id: id || 'MISSING', result: "Invalid or missing OrgUnitId" });
          continue;
        }

        console.log(`🔍 Looking up user by ${idType}: ${id} for course ${orgUnitId}`);

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
            console.warn(`⚠️ User not found: ${id}`);
            report.push({ id, orgUnitId, result: "User not found" });
            continue;
          }

          const payload = {
            OrgUnitId: orgUnitId,
            UserId: userId,
            RoleId: roleId,
            IsActive: true,
            SendEnrollmentEmail: sendEmail
          };

          console.log("📦 Payload:", payload);

          await BrightspaceFetch("/d2l/api/lp/1.43/enrollments/", "POST", payload);

          console.log(`✅ Enrolled ${id} into ${orgUnitId}`);
          report.push({ id, orgUnitId, result: "Enrolled" });

        } catch (err) {
          if (err.message.includes("403")) {
            report.push({ id, orgUnitId, result: "403 – Permission Denied" });
          } else {
            report.push({ id, orgUnitId, result: "Error" });
          }
          console.error(`❌ Failed to enroll ${id} into ${orgUnitId}:`, err);
        }
      }

      console.table(report);
      window.courseReport = report;

      const downloadBtn = document.createElement("button");
      downloadBtn.textContent = "Download Report";
      downloadBtn.style.marginTop = "10px";
      downloadBtn.className = "btn btn-primary";
      downloadBtn.type = "button";
      downloadBtn.addEventListener("click", () => downloadCSV(report));
      document.getElementById("enrollment-by-course-form").appendChild(downloadBtn);

      alert("✅ Course-specific enrollments complete. Check console for details.");
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

var downloadCourseReportBtn = document.getElementById('downloadCourseReportBtn');
if (downloadCourseReportBtn) {
  downloadCourseReportBtn.addEventListener('click', () => {
    if (!window.courseReport || !window.courseReport.length) {
      alert("No report data available.");
      return;
    }
    const headers = Object.keys(window.courseReport[0]);
    const rows = window.courseReport.map(obj => headers.map(h => JSON.stringify(obj[h] ?? "")));
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "course_enrollment_report.csv";
    link.click();
  });
}
