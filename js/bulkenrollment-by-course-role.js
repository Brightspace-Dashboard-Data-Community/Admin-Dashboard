document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('enrollment-by-course-role-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    console.log("🔄 Enrollment by Course & Role: Started");

    const fileInput = document.getElementById('csvCourseRoleFile');
    const idType = document.getElementById('csvCourseRoleIdType').value;
    const sendEmail = document.getElementById('csvCourseRoleSendEmail').checked;

    if (!fileInput.files.length) {
      alert("Please upload a CSV file.");
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    const report = [];

    reader.onload = async function (event) {
      const lines = event.target.result.trim().split('\n');
      console.log(`📄 Loaded ${lines.length} lines from CSV`);

      for (const [index, line] of lines.entries()) {
        const [id, orgUnitId, roleId] = line.split(',').map(val => val.replace(/"/g, '').trim());

        console.log(`➡️ Processing row ${index + 1}: ID=${id}, OrgUnitId=${orgUnitId}, RoleId=${roleId}`);
        try {
          let userId = null;

          if (idType === 'orgDefinedId') {
            const res = await BrightspaceFetch("/d2l/api/lp/1.46/users/?orgDefinedId=" + encodeURIComponent(id));
            userId = res[0]?.UserId;
          } else {
            const res = await BrightspaceFetch("/d2l/api/lp/1.46/users/?userName=" + encodeURIComponent(id));
            userId = res?.UserId;
          }

          if (!userId) {
            console.warn(`❌ User not found: ${id}`);
            report.push({ id, orgUnitId, roleId, result: "User not found" });
            continue;
          }

          const payload = {
            OrgUnitId: parseInt(orgUnitId),
            UserId: userId,
            RoleId: parseInt(roleId),
            IsActive: true,
            SendEnrollmentEmail: sendEmail
          };

          console.log("📤 Sending enrollment payload:", payload);
          await BrightspaceFetch("/d2l/api/lp/1.46/enrollments/", "POST", payload);
          report.push({ id, orgUnitId, roleId, result: "Enrolled" });

        } catch (err) {
          console.error(`❌ Error on row ${index + 1}:`, err);
          report.push({ id, orgUnitId, roleId, result: "Error: " + err.message });
        }
      }

      console.table(report);
      window.bulkEnrollmentCourseRoleReport = report;
      alert("Enrollment process completed. Click 'Download Report' to save.");
    };

    reader.readAsText(file);
  });

  var downloadCourseRoleReportBtn = document.getElementById('downloadCourseRoleReportBtn');
  if (downloadCourseRoleReportBtn) {
    downloadCourseRoleReportBtn.addEventListener('click', () => {
      const report = window.bulkEnrollmentCourseRoleReport || [];
      if (report.length === 0) {
        alert("No report data available.");
        return;
      }

      const csvRows = [
        ["OrgDefinedId", "OrgUnitId", "RoleId", "Result"],
        ...report.map(r => [r.id, r.orgUnitId, r.roleId, r.result])
      ];
      const csvContent = csvRows.map(row => row.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "bulk_enrollment_by_course_role_report.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
});
