let csvContent = '';
document.getElementById('generateBtn').addEventListener('click', async () => {
    document.getElementById('downloadBtn').style.display = 'none';
    document.getElementById('resultsBody').innerHTML = '';
    document.getElementById('totalCourses').textContent = '0';
    let loadingTask;
    const pdfFileInput = document.getElementById('pdfFile');
    const pdfUrlInput = document.getElementById('pdfUrl');
    if (pdfFileInput.files.length) {
        const file = pdfFileInput.files[0];
        const url = URL.createObjectURL(file);
        loadingTask = pdfjsLib.getDocument(url);
    } else if (pdfUrlInput.value) {
        loadingTask = pdfjsLib.getDocument(pdfUrlInput.value);
    } else {
        alert('Please upload a PDF or enter a URL.');
        return;
    }
    LoadingUtils.showLoadingModal('Processing PDF...');
    try {
        LoadingUtils.updateLoadingModal(10, 'Loading PDF...');
        const pdf = await loadingTask.promise;
        LoadingUtils.updateLoadingModal(20, `Processing ${pdf.numPages} pages...`);
        let textItems = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            textItems = textItems.concat(content.items.map(item => item.str.trim()));
            LoadingUtils.updateLoadingModal(20 + (p / pdf.numPages) * 40, `Processing page ${p} of ${pdf.numPages}...`);
        }
        LoadingUtils.updateLoadingModal(60, 'Extracting course data...');
        const coursePattern = /^[A-Z]{2,4}-\d{3}[A-Z]?-?[A-Z0-9]*$/;
        const datePattern = /\d{1,2}\/\d{1,2}\/\d{4}(?:\s*by\s*2pm)?$/i;
        const seenCourses = new Set();
        const rows = [];
        for (let i = 0; i < textItems.length; i++) {
            if (coursePattern.test(textItems[i])) {
                const course = textItems[i];
                if (seenCourses.has(course)) continue;
                seenCourses.add(course);
                let lastDate = null;
                for (let j = i + 1; j < Math.min(i + 40, textItems.length); j++) {
                    const candidate = textItems[j];
                    if (coursePattern.test(candidate)) break;
                    if (datePattern.test(candidate)) lastDate = candidate;
                }
                if (lastDate) {
                    const cleanedDue = lastDate.replace(/\s*by\s*2pm/i, '').trim();
                    rows.push([course, cleanedDue]);
                }
            }
        }
        LoadingUtils.updateLoadingModal(90, 'Generating report...');
        rows.forEach(([course, due]) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${course}</td><td>${due}</td>`;
            document.getElementById('resultsBody').appendChild(tr);
        });
        document.getElementById('totalCourses').textContent = rows.length;
        const headerLine = ['Course', 'Final Grades Due'].join(',');
        const lineRows = rows.map(r => r.join(','));
        csvContent = [headerLine, ...lineRows].join('\n');
        $('#resultsTable').DataTable({ pageLength: 25 });
        document.getElementById('downloadBtn').style.display = 'inline-flex';
        LoadingUtils.updateLoadingModal(100, 'Complete!');
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        setTimeout(() => LoadingUtils.hideLoadingModal(), 500);
    }
});
document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `semester_dates_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});
