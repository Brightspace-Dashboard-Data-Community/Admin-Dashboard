/**
 * Grade Submission Assessment Generator
 * Generates Word document from grade submission CSV
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize loading container
    const loadingContainer = LoadingUtils.createLoadingBar('loadingContainer');
    document.querySelector('.card').appendChild(loadingContainer);
    
    document.getElementById('generateReportBtn').addEventListener('click', async () => {
        const file = document.getElementById('csvFile').files[0];
        if (!file) {
            alert('Please upload a CSV file.');
            return;
        }
        
        const btn = document.getElementById('generateReportBtn');
        btn.disabled = true;
        LoadingUtils.showLoadingBar('loadingContainer');
        LoadingUtils.updateLoadingBar(10, 'Processing CSV file...', 'loadingContainer');
        
        try {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        LoadingUtils.updateLoadingBar(30, 'Generating Word document...', 'loadingContainer');
                        
                        // Create Word document
                        const doc = new docx.Document({
                            sections: [{
                                properties: {},
                                children: [
                                    new docx.Paragraph({
                                        text: 'Grade Submission Assessment Report',
                                        heading: docx.HeadingLevel.HEADING_1,
                                        spacing: { after: 200 }
                                    }),
                                    new docx.Paragraph({
                                        text: `Generated: ${new Date().toLocaleDateString()}`,
                                        spacing: { after: 400 }
                                    }),
                                    new docx.Table({
                                        columnWidths: [2000, 2000, 2000, 2000, 2000],
                                        rows: [
                                            new docx.TableRow({
                                                children: [
                                                    new docx.TableCell({ children: [new docx.Paragraph('Date')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph('Course ID')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph('Course Code')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph('Course Name')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph('Log Link')] })
                                                ]
                                            }),
                                            ...results.data.slice(0, 100).map(row => new docx.TableRow({
                                                children: [
                                                    new docx.TableCell({ children: [new docx.Paragraph(row.Date || '')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph(row['Course ID'] || '')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph(row['Course Code'] || '')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph(row['Course Name'] || '')] }),
                                                    new docx.TableCell({ children: [new docx.Paragraph(row['Log Link'] || '')] })
                                                ]
                                            }))
                                        ]
                                    })
                                ]
                            }]
                        });
                        
                        LoadingUtils.updateLoadingBar(80, 'Finalizing document...', 'loadingContainer');
                        
                        // Generate and download
                        const blob = await docx.Packer.toBlob(doc);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `grade-submission-assessment_${new Date().toISOString().slice(0, 10)}.docx`;
                        a.click();
                        URL.revokeObjectURL(url);
                        
                        LoadingUtils.updateLoadingBar(100, 'Complete!', 'loadingContainer');
                        setTimeout(() => {
                            LoadingUtils.hideLoadingBar('loadingContainer');
                        }, 500);
                    } catch (error) {
                        console.error('Error generating document:', error);
                        alert('Error generating document: ' + error.message);
                        LoadingUtils.hideLoadingBar('loadingContainer');
                    } finally {
                        btn.disabled = false;
                    }
                },
                error: (err) => {
                    console.error('CSV parse error:', err);
                    alert('Error parsing CSV: ' + err.message);
                    btn.disabled = false;
                    LoadingUtils.hideLoadingBar('loadingContainer');
                }
            });
        } catch (error) {
            console.error('Error:', error);
            alert('Error: ' + error.message);
            btn.disabled = false;
            LoadingUtils.hideLoadingBar('loadingContainer');
        }
    });
});
