/**
 * Grade Submission Report
 * Processes CSV from Course Log Deep Scan to generate grade submission status
 */

let finalResults = [];

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('csvFile');
    const processButton = document.getElementById('processFileBtn');
    const downloadButton = document.getElementById('downloadReportBtn');
    const statusBox = document.getElementById('status');
    const resultsTable = document.getElementById('resultsTable');
    const resultsCard = document.getElementById('resultsCard');
    const tbody = resultsTable.querySelector('tbody');

    processButton.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            alert('Please upload a CSV file.');
            return;
        }

        // Disable button and show loading modal
        processButton.disabled = true;
        statusBox.style.display = 'block';
        statusBox.textContent = '';
        
        // Destroy existing table if it exists
        if (window.jQuery && $.fn.DataTable && $.fn.DataTable.isDataTable(resultsTable)) {
            $(resultsTable).DataTable().destroy();
        }
        
        LoadingUtils.showLoadingModal('Initializing...', 'loadingModal', () => {
            // Cancel callback
        });
        LoadingUtils.updateLoadingModal(10, 'Parsing CSV file...', 'loadingModal');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                try {
                    LoadingUtils.updateLoadingModal(20, 'Filtering data...', 'loadingModal');
                    const filtered = results.data.filter(row => row.Tag === 'COLLAPSIBLE-CONTENT');

                    LoadingUtils.updateLoadingModal(30, 'Extracting course information...', 'loadingModal');
                    const parsed = filtered.map(row => {
                        const dateMatch = row.Text.match(/\d{4}\/\d{2}\/\d{2}/);
                        const idMatch = row.Text.match(/CourseOfferingId\s+(\d+)/);
                        return {
                            rawDate: dateMatch ? dateMatch[0] : null,
                            formattedDate: dateMatch ? new Date(dateMatch[0]).toLocaleDateString('en-US') : null,
                            courseId: idMatch ? idMatch[1] : null
                        };
                    }).filter(r => r.rawDate && r.courseId);

                    LoadingUtils.updateLoadingModal(40, `Fetching course details for ${parsed.length} courses...`, 'loadingModal');
                    
                    // Fetch course info for all courseIds
                    let processed = 0;
                    for (const r of parsed) {
                        // Check for cancellation
                        if (LoadingUtils.isCancelled('loadingModal')) {
                            LoadingUtils.hideLoadingModal('loadingModal');
                            processButton.disabled = false;
                            statusBox.textContent = 'Processing cancelled.';
                            return;
                        }
                        
                        try {
                            const course = await D2LApi._fetch(`/d2l/api/lp/1.49/courses/${r.courseId}`);
                            r.courseCode = course.Code;
                            r.courseName = course.Name;
                            r.logLink = `https://your-brightspace.example.edu/d2l/im/ipsis/grades/export/ilp/${r.courseId}/AllGradeExportsViewAll?retUrl=%2fd2l%2flms%2fgrades%2fadmin%2fenter%2fuser_list_view.d2l%3fou%3d${r.courseId}`;
                        } catch (err) {
                            r.courseCode = '❌ Error';
                            r.courseName = 'Could not fetch';
                            r.logLink = '#';
                        }
                        
                        processed++;
                        const progress = 40 + Math.floor((processed / parsed.length) * 50);
                        LoadingUtils.updateLoadingModal(progress, `Processing ${processed}/${parsed.length} courses...`, 'loadingModal');
                    }

                    // Store and display
                    finalResults = parsed;
                    tbody.innerHTML = '';
                    finalResults.forEach(r => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${r.formattedDate}</td>
                            <td>${r.courseId}</td>
                            <td>${r.courseCode}</td>
                            <td>${r.courseName}</td>
                            <td><a href="${r.logLink}" target="_blank" rel="noopener noreferrer">View Log</a></td>
                        `;
                        tbody.appendChild(row);
                    });

                    // Initialize DataTable with better configuration
                    if (window.jQuery && $.fn.DataTable) {
                        if ($.fn.DataTable.isDataTable(resultsTable)) {
                            $(resultsTable).DataTable().destroy();
                        }
                        $(resultsTable).DataTable({
                            pageLength: 25,
                            lengthMenu: [[10, 25, 50, 100, 200, -1], [10, 25, 50, 100, 200, "All"]],
                            order: [[0, 'asc']],
                            dom: '<"top"lf>rt<"bottom"ip><"clear">',
                            language: {
                                search: "Search:",
                                lengthMenu: "Show _MENU_ entries",
                                info: "Showing _START_ to _END_ of _TOTAL_ entries",
                                infoEmpty: "No entries to show",
                                infoFiltered: "(filtered from _MAX_ total entries)",
                                paginate: {
                                    first: "First",
                                    last: "Last",
                                    next: "Next",
                                    previous: "Previous"
                                }
                            },
                            responsive: true,
                            scrollX: true
                        });
                    }

                    LoadingUtils.updateLoadingModal(100, 'Complete!', 'loadingModal');
                    statusBox.textContent = `✅ Processed ${finalResults.length} course submissions.`;
                    resultsCard.style.display = 'block';
                    downloadButton.style.display = 'inline-flex';
                    
                    setTimeout(() => {
                        LoadingUtils.hideLoadingModal('loadingModal');
                    }, 1000);
                } catch (error) {
                    console.error('Error processing file:', error);
                    statusBox.textContent = '❌ Error processing file: ' + error.message;
                    LoadingUtils.hideLoadingModal('loadingModal');
                } finally {
                    processButton.disabled = false;
                }
            },
            error: function(err) {
                console.error('CSV parse error:', err);
                statusBox.textContent = '❌ Error parsing CSV file: ' + err.message;
                LoadingUtils.hideLoadingModal('loadingModal');
                processButton.disabled = false;
            }
        });
    });

    downloadButton.addEventListener('click', () => {
        if (!finalResults || finalResults.length === 0) {
            alert('No data available to download.');
            return;
        }

        const headers = ['Date', 'Course ID', 'Course Code', 'Course Name', 'Log Link'];
        const rows = finalResults.map(r => [
            r.formattedDate,
            r.courseId,
            r.courseCode,
            r.courseName,
            r.logLink
        ]);
        
        const csvContent = [headers, ...rows]
            .map(e => e.map(v => {
                const str = String(v || '');
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            }).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `grade-submission-report_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    });
});
