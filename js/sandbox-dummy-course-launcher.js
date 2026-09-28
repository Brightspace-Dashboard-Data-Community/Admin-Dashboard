/**
 * Sandbox Dummy Course Launcher
 * Tab 1: create/fill a 7-week Michigan History sandbox via Brightspace APIs.
 * Tab 2: zip of dummy-student dropbox/discussion files + quiz-question CSVs.
 */
(function () {
    'use strict';

    var LP = '1.49';
    var LP_USERS = '1.45';
    var LE = '1.78';
    var INSTRUCTOR_ROLE = 102;
    var DEMO_ROLE = 112;
    var FALLBACK_TEMPLATE = 6607;
    var STORAGE_KEY = 'sandboxDummyCourseLauncher.v1';

    var lastBuild = null;
    var packageContext = null;
    var el = {};

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        el.courseName = document.getElementById('course-name');
        el.codeSuffix = document.getElementById('course-code-suffix');
        el.existingOuField = document.getElementById('existing-ou-field');
        el.existingOu = document.getElementById('existing-ou');
        el.templateId = document.getElementById('template-id');
        el.semesterId = document.getElementById('semester-id');
        el.buildBtn = document.getElementById('build-btn');
        el.openCourseBtn = document.getElementById('open-course-btn');
        el.progressBar = document.getElementById('build-progress-bar');
        el.progressLabel = document.getElementById('build-progress-label');
        el.buildSteps = document.getElementById('build-steps');
        el.buildLog = document.getElementById('build-log');
        el.buildResult = document.getElementById('build-result');
        el.buildResultGrid = document.getElementById('build-result-grid');
        el.packageOu = document.getElementById('package-ou');
        el.loadPackageBtn = document.getElementById('load-package-btn');
        el.downloadZipBtn = document.getElementById('download-zip-btn');
        el.packageSummary = document.getElementById('package-summary');
        el.packageLog = document.getElementById('package-log');

        document.querySelectorAll('.tab-button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.tab-button').forEach(function (b) { b.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
                btn.classList.add('active');
                var pane = document.getElementById(btn.getAttribute('data-tab') + '-tab');
                if (pane) pane.classList.add('active');
            });
        });

        document.querySelectorAll('input[name="build-mode"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                el.existingOuField.style.display = getBuildMode() === 'existing' ? '' : 'none';
            });
        });

        el.buildBtn.addEventListener('click', runBuild);
        el.openCourseBtn.addEventListener('click', function () {
            if (lastBuild && lastBuild.orgUnitId) {
                window.open('/d2l/home/' + lastBuild.orgUnitId, '_blank');
            }
        });
        el.loadPackageBtn.addEventListener('click', loadPackageContext);
        el.downloadZipBtn.addEventListener('click', downloadStudentZip);
        restoreLastBuild();
    }

    function getBuildMode() {
        var checked = document.querySelector('input[name="build-mode"]:checked');
        return checked ? checked.value : 'create';
    }

    function restoreLastBuild() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            lastBuild = JSON.parse(raw);
            if (lastBuild && lastBuild.orgUnitId) {
                el.packageOu.value = String(lastBuild.orgUnitId);
                el.openCourseBtn.disabled = false;
                renderBuildResult(lastBuild, true);
                logBuild('Restored last build for OU ' + lastBuild.orgUnitId + '.');
            }
        } catch (e) {
            lastBuild = null;
        }
    }

    function saveLastBuild(data) {
        lastBuild = data;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    }

    /* ------------------------------------------------------------------ */
    /* Curriculum                                                          */
    /* ------------------------------------------------------------------ */

    function curriculum() {
        var weeks = [
            week(1, 'First Peoples of the Great Lakes',
                'Anishinaabe nations of the lakes, seasonal lifeways, and the meaning of Michigan as great water.',
                'https://www.youtube.com/watch?v=lY6i4ka_X-8',
                ['Council of Three Fires: Ojibwe, Odawa, Potawatomi', 'Seasonal rounds along the lakes', 'Place names that still mark the map', 'Water as the organizing geography']),
            week(2, 'French and British Michigan',
                'Detroit (1701), the fur trade, French-Indigenous alliances, and the British takeover.',
                'https://www.youtube.com/watch?v=YqKYpgZ9ZbI',
                ['Cadillac founds Detroit in 1701', 'Fur-trade networks of the pays d\'en haut', 'Pontiac\'s War after the British arrival', 'From fort to town on the strait']),
            week(3, 'Territory, 1812, and the Toledo War',
                'Michigan Territory, the War of 1812 on the lakes, and the border quarrel that delayed statehood.',
                'https://www.youtube.com/watch?v=qmxqg2PKJZU',
                ['Territory created in 1805', 'Detroit and Mackinac in 1812', 'Toledo Strip dispute with Ohio', 'Stevens T. Mason, the Boy Governor']),
            week(4, 'Statehood and the Underground Railroad',
                'Admission in 1837 and Michigan as a last stop toward Canada.',
                'https://www.youtube.com/watch?v=KySzlBBfcPs',
                ['Statehood in 1837', 'Lansing chosen as a central capital', 'Freedom corridors through Detroit and Adrian', 'Laura Haviland and local networks']),
            week(5, 'Lumber, Mining, and the Upper Peninsula',
                'Pine, copper, and iron tied the two peninsulas into one extractive economy.',
                'https://www.youtube.com/watch?v=0g7yrj9YZx8',
                ['White pine boom on Saginaw and Muskegon', 'Keweenaw copper and iron ranges', 'Soo Locks open in 1855', 'Company towns and immigrant labor']),
            week(6, 'Automobiles, Labor, and Detroit',
                'Ford, the moving assembly line, the UAW, and how auto work remade the state.',
                'https://www.youtube.com/watch?v=Pe9EMLXlhE8',
                ['Highland Park moving line, 1913', 'Five-Dollar Day and mass production', 'Flint Sit-Down Strike 1936-37', 'Great Migration and Motor City']),
            week(7, 'Modern Michigan and the Great Lakes',
                'The Mackinac Bridge, industrial change, and the lakes as a public trust.',
                'https://www.youtube.com/watch?v=K6QpM8dK3YI',
                ['Mackinac Bridge, 1957', 'Auto crisis and regional reinvention', 'Invasive species and water quality', 'Citizenship and the public trust'])
        ];

        var discussions = [
            { name: 'Week 1: What Does Michigan Mean to You?', gradeName: 'Discussion 1 Michigan Meaning', points: 10, prompt: '<p>The name Michigan is usually traced to an Ojibwe word for a large lake. How should a state named for water tell its history? Name one place or community this class should take seriously. Reply to at least one classmate.</p>' },
            { name: 'Week 4: Michigan and the Underground Railroad', gradeName: 'Discussion 2 Underground Railroad', points: 20, prompt: '<p>Michigan was often a last stop before Canada. Discuss one network, church, or person from the Week 4 materials and why geography made that work possible. Reply to at least one classmate.</p>' },
            { name: 'Week 7: The Great Lakes and Michigan\'s Future', gradeName: 'Discussion 3 Great Lakes Future', points: 20, prompt: '<p>What historical pattern from this course (industry, extraction, labor, or migration) still shapes a water or community issue in Michigan today? Reply to at least one classmate.</p>' }
        ];

        var dropboxes = [
            { name: 'Week 2: French Michigan Reflection', gradeName: 'Dropbox 1 French Michigan', points: 50, fileStub: 'Week2-French-Michigan-Reflection', instructions: '<p>Write 500-750 words on French Michigan: the fur trade, Indigenous alliances, and the British takeover. Submit a .docx file.</p>' },
            { name: 'Week 5: Resource Economy Essay', gradeName: 'Dropbox 2 Resource Economy', points: 50, fileStub: 'Week5-Resource-Economy-Essay', instructions: '<p>Write 750-1,000 words on lumber, copper, or iron in 19th-century Michigan and how extraction connected the U.P. to the lower lakes. Submit a .docx file.</p>' },
            { name: 'Week 7: Final Project — Community History', gradeName: 'Dropbox 3 Final Project', points: 100, fileStub: 'Week7-Final-Project', instructions: '<p>Choose one Michigan community. In 1,000-1,250 words, connect it to at least two course themes. Submit a .docx file.</p>' }
        ];

        var quizzes = [
            { name: 'Quiz 1: Territory and Statehood', gradeName: 'Quiz 1 Territory Statehood', points: 20, csvName: 'Quiz-1-Territory-and-Statehood.csv', instructions: '<p>Covers Weeks 1-4. Five questions will be imported from Tab 2.</p>', questions: quizOneQuestions() },
            { name: 'Quiz 2: Industry and Labor', gradeName: 'Quiz 2 Industry Labor', points: 20, csvName: 'Quiz-2-Industry-and-Labor.csv', instructions: '<p>Covers Weeks 5-6. Five questions will be imported from Tab 2.</p>', questions: quizTwoQuestions() },
            { name: 'Quiz 3: Comprehensive Michigan History', gradeName: 'Quiz 3 Comprehensive', points: 30, csvName: 'Quiz-3-Comprehensive.csv', instructions: '<p>Cumulative quiz. Five questions will be imported from Tab 2.</p>', questions: quizThreeQuestions() }
        ];

        var students = [
            { firstName: 'Ada', lastName: 'ZZSandbox', city: 'Ada', voice: 'careful' },
            { firstName: 'Lansing', lastName: 'ZZSandbox', city: 'Lansing', voice: 'mid' },
            { firstName: 'Marquette', lastName: 'ZZSandbox', city: 'Marquette', voice: 'up' }
        ];

        return { weeks: weeks, discussions: discussions, dropboxes: dropboxes, quizzes: quizzes, students: students };
    }

    function week(num, title, summary, youtubeUrl, bullets) {
        return {
            num: num,
            title: 'Week ' + num + ': ' + title,
            short: 'Week ' + num,
            summary: summary,
            bullets: bullets,
            youtube: { title: 'Video: Week ' + num, url: youtubeUrl },
            htmlTitle: 'Overview: ' + title,
            pptTitle: 'Lecture: ' + title,
            pdfTitle: 'Reading: ' + title,
            docTitle: 'Worksheet: Week ' + num
        };
    }

    function quizOneQuestions() {
        return [
            mc('Michigan became the 26th U.S. state in which year?', ['1837', '1805', '1812', '1855'], 0),
            mc('What is the capital of Michigan?', ['Lansing', 'Detroit', 'Ann Arbor', 'Grand Rapids'], 0),
            tf('The Toledo War was a border dispute between Michigan and Ohio.', true),
            mc('Who was Michigan\'s "Boy Governor" at statehood?', ['Stevens T. Mason', 'Lewis Cass', 'Henry Ford', 'Antoine Cadillac'], 0),
            mc('Which bargain helped end the Toledo dispute?', ['Michigan received the Upper Peninsula', 'Michigan kept Toledo', 'Ohio joined Canada', 'The capital moved to Detroit'], 0)
        ];
    }

    function quizTwoQuestions() {
        return [
            mc('Ford\'s moving assembly line at Highland Park is usually dated to:', ['1913', '1837', '1957', '1701'], 0),
            mc('The Flint Sit-Down Strike is most closely tied to which organization?', ['UAW', 'NFL', 'CCC', 'UNICEF'], 0),
            tf('Copper mining was a major 19th-century industry in Michigan\'s Upper Peninsula.', true),
            mc('The Soo Locks, opened in 1855, connect Lake Superior to:', ['The lower Great Lakes via the St. Marys River', 'The Mississippi River', 'Lake Ontario only', 'Hudson Bay'], 0),
            mc('The Five-Dollar Day is associated with:', ['Henry Ford and mass production wages', 'Stevens T. Mason', 'The Toledo War', 'The Mackinac Bridge toll'], 0)
        ];
    }

    function quizThreeQuestions() {
        return [
            mc('The name Michigan is commonly traced to an Anishinaabe word referring to:', ['A large lake or great water', 'A mountain pass', 'A desert', 'A prairie fire'], 0),
            mc('Which bridge (1957) physically joined Michigan\'s two peninsulas?', ['Mackinac Bridge', 'Ambassador Bridge', 'Brooklyn Bridge', 'Golden Gate Bridge'], 0),
            tf('Detroit was founded by Antoine de la Mothe Cadillac in 1701.', true),
            mc('Laura Haviland is remembered in Michigan history primarily for:', ['Underground Railroad and abolition work', 'Designing the Soo Locks', 'Founding Ford Motor Company', 'Surveying the Toledo Strip'], 0),
            mc('Michigan\'s shoreline touches how many of the five Great Lakes?', ['Four (all except Ontario)', 'One', 'Five', 'Two'], 0)
        ];
    }

    function mc(text, options, correct) {
        return { type: 'MC', text: text, options: options, correct: correct, points: 1 };
    }

    function tf(text, isTrue) {
        return { type: 'TF', text: text, isTrue: isTrue, points: 1 };
    }

    /* ------------------------------------------------------------------ */
    /* File generators                                                     */
    /* ------------------------------------------------------------------ */

    function xmlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pdfEscape(value) {
        return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function asciiOnly(text) {
        return String(text || '').replace(/[^\x20-\x7E]/g, ' ');
    }

    function wrapText(text, width) {
        var words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
        var lines = [];
        var current = '';
        words.forEach(function (word) {
            var next = current ? current + ' ' + word : word;
            if (next.length > width && current) {
                lines.push(current);
                current = word;
            } else current = next;
        });
        if (current) lines.push(current);
        return lines.length ? lines : [''];
    }

    function slug(value) {
        return String(value || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function strBytes(text) {
        return new TextEncoder().encode(String(text || ''));
    }

    function buildHtmlPage(title, paragraphs, bullets) {
        var body = (paragraphs || []).map(function (p) { return '<p>' + xmlEscape(p) + '</p>'; }).join('');
        var list = (bullets && bullets.length)
            ? '<h2>Key points</h2><ul>' + bullets.map(function (b) { return '<li>' + xmlEscape(b) + '</li>'; }).join('') + '</ul>'
            : '';
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + xmlEscape(title) +
            '</title><style>body{font-family:Georgia,serif;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.55;color:#222}h1{color:#1a5d1a}.note{font-size:13px;color:#555;border-left:4px solid #1a5d1a;padding:8px 12px;background:#f5f7fa}</style></head><body>' +
            '<p class="note">Dummy content for a Michigan History sandbox course.</p><h1>' + xmlEscape(title) + '</h1>' +
            body + list + '</body></html>';
    }

    function buildPdf(title, paragraphs) {
        var commands = ['BT /F1 16 Tf 50 740 Td (' + pdfEscape(asciiOnly(title)) + ') Tj ET'];
        var y = 710;
        (paragraphs || []).forEach(function (p) {
            wrapText(asciiOnly(p), 88).forEach(function (line) {
                if (y < 72) return;
                commands.push('BT /F1 11 Tf 50 ' + y + ' Td (' + pdfEscape(line) + ') Tj ET');
                y -= 16;
            });
            y -= 10;
        });
        var stream = commands.join('\n');
        var objects = [
            '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
            '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
            '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
            '4 0 obj << /Length ' + stream.length + ' >> stream\n' + stream + '\nendstream endobj\n',
            '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n'
        ];
        var header = '%PDF-1.4\n';
        var body = '';
        var xref = ['xref\n', '0 6\n', '0000000000 65535 f \n'];
        var offset = header.length;
        objects.forEach(function (obj) {
            xref.push(String(offset).padStart(10, '0') + ' 00000 n \n');
            body += obj;
            offset = header.length + body.length;
        });
        return header + body + xref.join('') + 'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n' + (header.length + body.length) + '\n%%EOF';
    }

    async function buildDocx(title, paragraphs) {
        if (!window.JSZip) throw new Error('JSZip is not loaded');
        var zip = new JSZip();
        var paras = ['<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>' + xmlEscape(title) + '</w:t></w:r></w:p>'];
        (paragraphs || []).forEach(function (p) {
            paras.push('<w:p><w:r><w:t xml:space="preserve">' + xmlEscape(p) + '</w:t></w:r></w:p>');
        });
        zip.file('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
            '</Types>');
        zip.folder('_rels').file('.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>');
        var word = zip.folder('word');
        word.file('document.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
            paras.join('') + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>');
        word.file('styles.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style></w:styles>');
        word.folder('_rels').file('document.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>');
        return zip.generateAsync({ type: 'uint8array' });
    }

    async function buildPptx(title, bullets) {
        if (!window.JSZip) throw new Error('JSZip is not loaded');
        var zip = new JSZip();
        zip.file('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
            '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
            '</Types>');
        zip.folder('_rels').file('.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
            '</Relationships>');
        var ppt = zip.folder('ppt');
        ppt.file('presentation.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
            '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
            '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
        ppt.folder('_rels').file('presentation.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
            '</Relationships>');
        ppt.folder('slides').file('slide1.xml', pptSlideXml(title, bullets || []));
        ppt.folder('slides').folder('_rels').file('slide1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
            '</Relationships>');
        ppt.folder('slideLayouts').file('slideLayout1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">' +
            '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
        ppt.folder('slideLayouts').folder('_rels').file('slideLayout1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
            '</Relationships>');
        ppt.folder('slideMasters').file('slideMaster1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
            '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');
        ppt.folder('slideMasters').folder('_rels').file('slideMaster1.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
            '</Relationships>');
        ppt.folder('theme').file('theme1.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements>' +
            '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
            '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
            '<a:accent1><a:srgbClr val="1A5D1A"/></a:accent1><a:accent2><a:srgbClr val="4CAF50"/></a:accent2>' +
            '<a:accent3><a:srgbClr val="C0504D"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>' +
            '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>' +
            '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>' +
            '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>' +
            '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
            '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>' +
            '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
            '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
            '</a:fmtScheme></a:themeElements></a:theme>');
        return zip.generateAsync({ type: 'uint8array' });
    }

    function pptSlideXml(title, bullets) {
        var y = 1800000;
        var shapes = [
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
            '<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
            '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800" b="1"><a:solidFill><a:srgbClr val="1A5D1A"/></a:solidFill></a:rPr><a:t>' +
            xmlEscape(title) + '</a:t></a:r></a:p></p:txBody></p:sp>'
        ];
        (bullets || []).forEach(function (b, i) {
            shapes.push(
                '<p:sp><p:nvSpPr><p:cNvPr id="' + (i + 3) + '" name="B' + i + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
                '<p:spPr><a:xfrm><a:off x="457200" y="' + y + '"/><a:ext cx="8229600" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
                '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1600"/><a:t>' + xmlEscape('• ' + b) + '</a:t></a:r></a:p></p:txBody></p:sp>'
            );
            y += 480000;
        });
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
            '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
            '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
            shapes.join('') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
    }

    function questionsToCsv(quizName, questions) {
        var lines = ['// Brightspace Question Library CSV', '// Quiz: ' + quizName];
        (questions || []).forEach(function (q, idx) {
            lines.push('');
            if (q.type === 'TF') {
                lines.push('NewQuestion,TF');
                lines.push('Title,Q' + (idx + 1));
                lines.push('QuestionText,' + csvCell(q.text));
                lines.push('Points,' + (q.points || 1));
                lines.push('True,' + (q.isTrue ? '100' : '0'));
                lines.push('False,' + (q.isTrue ? '0' : '100'));
            } else {
                lines.push('NewQuestion,MC');
                lines.push('Title,Q' + (idx + 1));
                lines.push('QuestionText,' + csvCell(q.text));
                lines.push('Points,' + (q.points || 1));
                (q.options || []).forEach(function (opt, i) {
                    lines.push('Option,' + (i === q.correct ? '100' : '0') + ',' + csvCell(opt));
                });
            }
        });
        return lines.join('\r\n') + '\r\n';
    }

    function csvCell(value) {
        var text = String(value == null ? '' : value);
        if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    /* ------------------------------------------------------------------ */
    /* API                                                                 */
    /* ------------------------------------------------------------------ */

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function apiJson(url, options) {
        var opts = options || {};
        return D2LApi._fetch(url, {
            method: opts.method || 'GET',
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
    }

    async function postJsonWithFallback(url, payload, wrappers) {
        try {
            return await apiJson(url, { method: 'POST', body: payload });
        } catch (err) {
            var msg = String(err && err.message || '');
            var canRetry = wrappers && wrappers.length &&
                (msg.indexOf('400') !== -1 || /invalid|JSON Binding/i.test(msg));
            if (!canRetry) throw err;
            var lastError = err;
            for (var i = 0; i < wrappers.length; i += 1) {
                try {
                    logBuild('Retrying POST with alternate JSON shape…');
                    return await apiJson(url, { method: 'POST', body: wrappers[i](payload) });
                } catch (retryErr) {
                    lastError = retryErr;
                }
            }
            throw lastError;
        }
    }

    function csrfToken() {
        return localStorage.getItem('XSRF.Token') || sessionStorage.getItem('XSRF.Token') || '';
    }

    async function postNewsItem(url, payload) {
        var boundary = 'xxBOUNDARYxx';
        var json = JSON.stringify(payload);
        var body = '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + json + '\r\n--' + boundary + '--\r\n';
        return D2LApi._fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/mixed; boundary=' + boundary },
            body: body
        });
    }

    async function postMultipartMixed(url, jsonObject, fileName, fileBytes, mime) {
        var boundary = 'xxBOUNDARYxx';
        var json = JSON.stringify(jsonObject);
        var chunks = [strBytes('--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + json + '\r\n')];
        if (fileName && fileBytes) {
            chunks.push(strBytes('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fileName + '"\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n'));
            chunks.push(fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes));
            chunks.push(strBytes('\r\n'));
        }
        chunks.push(strBytes('--' + boundary + '--\r\n'));
        var total = 0;
        chunks.forEach(function (c) { total += c.length; });
        var body = new Uint8Array(total);
        var offset = 0;
        chunks.forEach(function (c) { body.set(c, offset); offset += c.length; });
        var headers = {
            'Accept': 'application/json',
            'Content-Type': 'multipart/mixed; boundary=' + boundary
        };
        var token = csrfToken();
        if (token) headers['X-CSRF-Token'] = token;
        var response = await fetch(url, { method: 'POST', headers: headers, body: body, credentials: 'include' });
        var newToken = response.headers.get('x-csrf-token');
        if (newToken) localStorage.setItem('XSRF.Token', newToken);
        var text = await response.text();
        if (!response.ok) throw new Error('API Error: ' + response.status + ' ' + response.statusText + (text ? ' — ' + text.slice(0, 400) : ''));
        if (!text || !text.trim()) return {};
        try { return JSON.parse(text); } catch (e) { return text; }
    }

    function rich(html) {
        return { Content: html || '', Type: 'Html' };
    }

    function richText(html) {
        var text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return { Text: text, Html: html || '' };
    }

    function quizRich(html, displayed, type) {
        return { Text: { Content: html || '', Type: type || 'Html' }, IsDisplayed: !!displayed };
    }

    function asD2lId(value) {
        if (value == null || value === '') return null;
        var n = Number(value);
        return isFinite(n) ? n : null;
    }

    function findByName(list, name) {
        var wanted = String(name || '').trim().toLowerCase();
        if (!wanted) return null;
        return (list || []).find(function (item) {
            var label = item && (item.Name || item.name || item.Title || item.title || '');
            return String(label).trim().toLowerCase() === wanted;
        }) || null;
    }

    function extractId(obj) {
        if (!obj) return null;
        var raw = obj.Id || obj.QuizId || obj.FolderId || obj.TopicId || obj.ForumId || obj.UserId || obj.GradeObjectId || obj.Identifier || null;
        return asD2lId(raw) != null ? asD2lId(raw) : raw;
    }

    function asList(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.Objects)) return data.Objects;
        if (data && Array.isArray(data.Items)) return data.Items;
        return [];
    }

    /* ------------------------------------------------------------------ */
    /* UI logging                                                          */
    /* ------------------------------------------------------------------ */

    function appendLog(node, fallback, message) {
        if (!node) return;
        var line = '[' + new Date().toLocaleTimeString() + '] ' + message;
        if (!node.textContent || node.textContent === fallback) node.textContent = line;
        else node.textContent += '\n' + line;
        node.scrollTop = node.scrollHeight;
    }

    function logBuild(message) { appendLog(el.buildLog, 'Waiting to launch…', message); }
    function logPackage(message) { appendLog(el.packageLog, 'Waiting to load a course…', message); }

    function setProgress(pct, label) {
        if (el.progressBar) el.progressBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (el.progressLabel) el.progressLabel.textContent = label || '';
    }

    function resetSteps(names) {
        el.buildSteps.innerHTML = '';
        names.forEach(function (name, i) {
            var row = document.createElement('div');
            row.className = 'step-item';
            row.id = 'step-' + i;
            row.innerHTML = '<span class="badge">WAIT</span><span>' + xmlEscape(name) + '</span>';
            el.buildSteps.appendChild(row);
        });
    }

    function markStep(index, status, detail) {
        var row = document.getElementById('step-' + index);
        if (!row) return;
        row.classList.remove('ok', 'fail', 'run');
        row.classList.add(status === 'ok' ? 'ok' : status === 'fail' ? 'fail' : 'run');
        var badge = row.querySelector('.badge');
        if (badge) badge.textContent = status === 'ok' ? 'OK' : status === 'fail' ? 'FAIL' : 'RUN';
        if (detail) {
            var span = row.querySelector('span:last-child');
            if (span) span.textContent = detail;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Tab 1                                                               */
    /* ------------------------------------------------------------------ */

    async function runBuild() {
        if (typeof D2LApi === 'undefined') {
            logBuild('ERROR: D2LApi is not loaded. Open this tool from the Admin Dashboard inside Brightspace.');
            return;
        }
        var data = curriculum();
        var mode = getBuildMode();
        var courseName = (el.courseName.value || '').trim() || 'Michigan History Dummy Course';
        var suffix = (el.codeSuffix.value || '').trim();
        if (!suffix) {
            var now = new Date();
            suffix = String(now.getFullYear()).slice(-2) +
                pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes());
        }
        var courseCode = 'Sandbox-MIHist-' + suffix.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 40);
        var existingOu = (el.existingOu.value || '').trim();
        if (mode === 'existing' && !existingOu) {
            logBuild('ERROR: Enter an existing OrgUnitId, or switch back to Create a new sandbox.');
            return;
        }

        resetSteps([
            'Resolve course',
            'Enroll you as Instructor',
            'Create 3 dummy students',
            'Post welcome news',
            'Set points gradebook (9 items)',
            'Create 7 content weeks',
            'Create 3 discussions',
            'Create 3 dropboxes',
            'Create 3 quizzes (no questions)'
        ]);
        el.buildResult.style.display = 'none';
        el.buildLog.textContent = '';
        el.buildBtn.disabled = true;
        setProgress(2, 'Starting…');

        var result = {
            orgUnitId: null,
            courseName: courseName,
            courseCode: courseCode,
            students: [],
            dropboxes: [],
            discussions: [],
            quizzes: [],
            grades: [],
            builtAt: new Date().toISOString()
        };

        try {
            markStep(0, 'run');
            var ou = existingOu;
            if (mode === 'create') {
                logBuild('Creating sandbox "' + courseName + '" (' + courseCode + ')…');
                var created = await createSandboxCourse(courseName, courseCode, el.templateId.value, el.semesterId.value);
                ou = String(extractId(created));
                result.courseName = created.Name || courseName;
                result.courseCode = created.Code || courseCode;
                logBuild('Created OrgUnitId ' + ou);
            } else {
                logBuild('Loading existing course ' + existingOu + '…');
                var course = await apiJson('/d2l/api/lp/' + LP + '/courses/' + encodeURIComponent(existingOu));
                ou = String(extractId(course) || existingOu);
                result.courseName = course.Name || courseName;
                result.courseCode = course.Code || courseCode;
            }
            if (!ou) throw new Error('No OrgUnitId returned from course create/load.');
            result.orgUnitId = ou;
            markStep(0, 'ok', 'Course OU ' + ou);
            setProgress(10, 'Course ready');

            markStep(1, 'run');
            await enrollCurrentUser(ou);
            markStep(1, 'ok', 'Instructor enrolled');
            setProgress(16, 'Instructor enrolled');

            markStep(2, 'run');
            result.students = await createDummyStudents(ou, data.students);
            markStep(2, 'ok', result.students.length + ' dummy students');
            setProgress(28, 'Students ready');

            markStep(3, 'run');
            var newsOk = await postWelcomeNews(ou, result.courseName);
            markStep(3, newsOk ? 'ok' : 'fail', newsOk ? 'Welcome news posted' : 'News skipped — continuing');
            setProgress(34, newsOk ? 'News posted' : 'News skipped, continuing');

            markStep(4, 'run');
            result.grades = await createGradebook(ou, data);
            markStep(4, 'ok', result.grades.length + ' grade items');
            setProgress(42, 'Gradebook ready');

            markStep(5, 'run');
            try {
                await createContentWeeks(ou, data.weeks);
                markStep(5, 'ok', '7 weekly modules');
            } catch (err) {
                logBuild('Content weeks failed (continuing): ' + err.message);
                markStep(5, 'fail', 'Content skipped — continuing');
            }
            setProgress(70, 'Content step done');

            markStep(6, 'run');
            try {
                result.discussions = await createDiscussions(ou, data.discussions, result.grades);
                markStep(6, result.discussions.length ? 'ok' : 'fail', result.discussions.length + ' discussion topics');
            } catch (err) {
                logBuild('Discussions failed (continuing): ' + err.message);
                markStep(6, 'fail', 'Discussions skipped — continuing');
            }
            setProgress(80, 'Discussions step done');

            markStep(7, 'run');
            try {
                result.dropboxes = await createDropboxes(ou, data.dropboxes, result.grades);
                markStep(7, result.dropboxes.length ? 'ok' : 'fail', result.dropboxes.length + ' dropboxes');
            } catch (err) {
                logBuild('Dropboxes failed (continuing): ' + err.message);
                markStep(7, 'fail', 'Dropboxes skipped — continuing');
            }
            setProgress(90, 'Dropboxes step done');

            markStep(8, 'run');
            try {
                result.quizzes = await createQuizzes(ou, data.quizzes, result.grades);
                markStep(8, result.quizzes.length ? 'ok' : 'fail', result.quizzes.length + ' quizzes (no questions)');
            } catch (err) {
                logBuild('Quizzes failed (continuing): ' + err.message);
                markStep(8, 'fail', 'Quizzes skipped — continuing');
            }
            setProgress(100, 'Dummy course complete');

            saveLastBuild(result);
            el.packageOu.value = String(ou);
            el.openCourseBtn.disabled = false;
            renderBuildResult(result, false);
            logBuild('Done. Open the course, then use Tab 2 for student work files and quiz CSVs.');
        } catch (err) {
            logBuild('ERROR: ' + (err && err.message ? err.message : err));
            setProgress(100, 'Stopped with an error');
        } finally {
            el.buildBtn.disabled = false;
        }
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    async function createSandboxCourse(name, code, templateId, semesterId) {
        var description = '7-week Michigan History dummy course for admin training, impersonation, and tool practice.';
        var templates = [parseInt(templateId, 10) || 2966247, FALLBACK_TEMPLATE];
        var semesters = [parseInt(semesterId, 10) || 2993337, null];
        var lastError = null;
        for (var t = 0; t < templates.length; t += 1) {
            for (var s = 0; s < semesters.length; s += 1) {
                var payload = {
                    Name: name,
                    Code: code,
                    CourseTemplateId: templates[t],
                    Path: '',
                    StartDate: null,
                    EndDate: null,
                    SemesterId: semesters[s],
                    LocaleId: null,
                    ForceLocale: false,
                    ShowAddressBook: false,
                    Description: { Content: description, Type: 'Text' },
                    CanSelfRegister: false
                };
                try {
                    logBuild('Trying template ' + templates[t] + ', semester ' + (semesters[s] || 'none') + '…');
                    var created = await apiJson('/d2l/api/lp/' + LP + '/courses/', { method: 'POST', body: payload });
                    if (extractId(created)) return created;
                } catch (err) {
                    lastError = err;
                    logBuild('Create attempt failed: ' + err.message);
                }
            }
        }
        throw lastError || new Error('Could not create sandbox course.');
    }

    async function enrollCurrentUser(ou) {
        var me = await D2LApi.getWhoAmI();
        var userId = me && (me.Identifier || me.UserId);
        if (!userId) {
            logBuild('Could not read WhoAmI; skipping instructor enroll.');
            return;
        }
        try {
            await apiJson('/d2l/api/lp/' + LP + '/enrollments/', {
                method: 'POST',
                body: { OrgUnitId: Number(ou), UserId: Number(userId), RoleId: INSTRUCTOR_ROLE, IsCascading: false }
            });
            logBuild('Enrolled current user ' + userId + ' as Instructor.');
        } catch (err) {
            logBuild('Instructor enroll skipped or already present: ' + err.message);
        }
    }

    async function findUserByUserName(userName) {
        try {
            var response = await apiJson('/d2l/api/lp/' + LP_USERS + '/users/?userName=' + encodeURIComponent(userName));
            if (Array.isArray(response)) return response[0] || null;
            if (response && (response.UserId || response.Identifier)) return response;
            return null;
        } catch (err) {
            if (String(err.message || '').indexOf('404') !== -1) return null;
            throw err;
        }
    }

    async function createDummyStudents(ou, students) {
        var created = [];
        for (var i = 0; i < students.length; i += 1) {
            var spec = students[i];
            var userName = 'ZZSandbox-' + spec.firstName + '-' + ou;
            var email = ('zzsandbox-' + spec.firstName + '-' + ou + '@example.edu').toLowerCase();
            var user = await findUserByUserName(userName);
            if (!user) {
                logBuild('Creating dummy student ' + userName + '…');
                user = await apiJson('/d2l/api/lp/' + LP_USERS + '/users/', {
                    method: 'POST',
                    body: {
                        OrgDefinedId: 'ZZSB-' + ou + '-' + (i + 1),
                        FirstName: spec.firstName,
                        MiddleName: '',
                        LastName: spec.lastName,
                        ExternalEmail: email,
                        UserName: userName,
                        RoleId: DEMO_ROLE,
                        IsActive: true,
                        SendCreationEmail: false,
                        Pronouns: ''
                    }
                });
            } else {
                logBuild('Dummy student already exists: ' + userName);
            }
            var userId = extractId(user);
            try {
                await apiJson('/d2l/api/lp/' + LP + '/enrollments/', {
                    method: 'POST',
                    body: { OrgUnitId: Number(ou), UserId: Number(userId), RoleId: DEMO_ROLE, IsCascading: false }
                });
                logBuild('Enrolled ' + userName + ' (' + userId + ').');
            } catch (err) {
                logBuild('Enroll ' + userName + ': ' + err.message);
            }
            created.push({
                userId: userId,
                userName: userName,
                firstName: spec.firstName,
                lastName: spec.lastName,
                email: email,
                city: spec.city,
                voice: spec.voice
            });
            await sleep(150);
        }
        return created;
    }

    async function postWelcomeNews(ou, courseName) {
        var payload = {
            Title: 'Welcome to ' + courseName,
            Body: {
                Text: 'This is a 7-week dummy Michigan History course for training. Impersonate Ada, Lansing, or Marquette ZZSandbox. Quiz questions and student submissions are in Tab 2 of the Dummy Course Launcher.',
                Html: '<p>Welcome to this <strong>7-week dummy Michigan History</strong> course, generated for admin training.</p><p>Use Classlist to impersonate <strong>Ada ZZSandbox</strong>, <strong>Lansing ZZSandbox</strong>, or <strong>Marquette ZZSandbox</strong>.</p><p>Quizzes were created without questions on purpose. Download the student work package (Tab 2) for Brightspace CSV questions and sample dropbox/discussion files.</p>'
            },
            StartDate: new Date().toISOString(),
            EndDate: null,
            IsGlobal: false,
            IsPublished: true,
            ShowOnlyInCourseOfferings: false,
            IsAuthorInfoShown: false,
            IsPinned: false,
            IsStartDateShown: false,
            SortOrder: null
        };
        var urls = [
            '/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/news/',
            '/d2l/api/le/1.78/' + encodeURIComponent(ou) + '/news/'
        ];
        for (var i = 0; i < urls.length; i += 1) {
            try {
                await postNewsItem(urls[i], payload);
                logBuild('Posted welcome news.');
                return true;
            } catch (err) {
                logBuild('News multipart POST failed (' + urls[i] + '): ' + err.message);
            }
        }
        try {
            await apiJson('/d2l/api/le/1.78/' + encodeURIComponent(ou) + '/news/', {
                method: 'POST',
                body: {
                    Title: payload.Title,
                    Body: { Content: payload.Body.Html, Type: 'Html' },
                    StartDate: payload.StartDate,
                    EndDate: null,
                    IsGlobal: false,
                    IsPublished: true,
                    ShowOnlyInCourseOfferings: false,
                    IsAuthorInfoShown: false,
                    IsPinned: false,
                    IsStartDateShown: false
                }
            });
            logBuild('Posted welcome news (JSON fallback).');
            return true;
        } catch (err) {
            logBuild('News JSON POST failed: ' + err.message);
        }
        logBuild('Skipping welcome news so the rest of the course can still build.');
        return false;
    }

    async function createGradebook(ou, data) {
        try {
            var setup = await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/grades/setup/');
            if (setup) {
                if (setup.GradingSystem === 'Weighted') setup.GradingSystem = 'Points';
                if (setup.GradingSystem === 2) setup.GradingSystem = 1;
                try {
                    await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/grades/setup/', { method: 'PUT', body: setup });
                    logBuild('Gradebook set to points.');
                } catch (e) {
                    logBuild('Could not rewrite grade setup (continuing): ' + e.message);
                }
            }
        } catch (e) {
            logBuild('Grade setup read skipped: ' + e.message);
        }

        var schemeId = null;
        try {
            var schemes = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/grades/schemes/'));
            if (schemes[0]) schemeId = schemes[0].Id || schemes[0].SchemeId || null;
        } catch (e) { /* optional */ }

        var specs = [];
        data.discussions.forEach(function (d) { specs.push({ name: d.gradeName, short: d.gradeName.slice(0, 20), points: d.points, key: d.gradeName }); });
        data.dropboxes.forEach(function (d) { specs.push({ name: d.gradeName, short: d.gradeName.slice(0, 20), points: d.points, key: d.gradeName }); });
        data.quizzes.forEach(function (q) { specs.push({ name: q.gradeName, short: q.gradeName.slice(0, 20), points: q.points, key: q.gradeName }); });
        specs = specs.slice(0, 9);

        var existing = [];
        try {
            existing = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/grades/'));
        } catch (e) {
            logBuild('Could not list existing grade items: ' + e.message);
        }

        var created = [];
        for (var i = 0; i < specs.length; i += 1) {
            var spec = specs[i];
            var reused = findByName(existing, spec.name);
            if (reused) {
                created.push({ id: extractId(reused), name: spec.name, points: spec.points, key: spec.key });
                logBuild('Reusing grade item: ' + spec.name);
                continue;
            }
            var payload = {
                MaxPoints: spec.points,
                CanExceedMaxPoints: false,
                IsBonus: false,
                ExcludeFromFinalGradeCalculation: false,
                GradeSchemeId: schemeId,
                Name: spec.name,
                ShortName: spec.short,
                GradeType: 'Numeric',
                CategoryId: 0,
                Description: rich('Dummy points item for the Michigan History sandbox.'),
                Hidden: false
            };
            try {
                var item = await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/grades/', { method: 'POST', body: payload });
                created.push({ id: extractId(item), name: spec.name, points: spec.points, key: spec.key });
                logBuild('Grade item: ' + spec.name + ' (' + spec.points + ' pts)');
            } catch (err) {
                logBuild('Grade item failed (' + spec.name + '): ' + err.message);
            }
            await sleep(80);
        }
        return created;
    }

    function gradeIdByKey(grades, key) {
        var found = (grades || []).find(function (g) { return g.key === key || g.name === key; });
        return found ? asD2lId(found.id) : null;
    }

    async function createContentWeeks(ou, weeks) {
        var existingModules = [];
        try {
            existingModules = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/content/root/'));
        } catch (e) {
            logBuild('Could not list existing modules: ' + e.message);
        }
        for (var i = 0; i < weeks.length; i += 1) {
            var weekData = weeks[i];
            if (findByName(existingModules, weekData.title)) {
                logBuild('Reusing existing module: ' + weekData.title);
                continue;
            }
            logBuild('Creating ' + weekData.title + '…');
            try {
            var modulePayload = {
                Title: weekData.title,
                ShortTitle: weekData.short,
                Type: 0,
                ModuleStartDate: null,
                ModuleEndDate: null,
                ModuleDueDate: null,
                IsHidden: false,
                IsLocked: false,
                Description: rich('<p>' + xmlEscape(weekData.summary) + '</p>'),
                Duration: null
            };
            var module = await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/content/root/', { method: 'POST', body: modulePayload });
            var moduleId = extractId(module);
            if (!moduleId) throw new Error('Module create returned no Id for ' + weekData.title);

            var html = buildHtmlPage(weekData.htmlTitle, [
                weekData.summary,
                'This dummy module is meant to look like a real weekly lesson: a webpage, a short lecture deck, a reading, a worksheet, and a video.',
                'Use it to practice impersonation, content checks, and student-view walkthroughs.'
            ], weekData.bullets);
            await createFileTopic(ou, moduleId, weekData.htmlTitle, slug(weekData.short) + '-overview.html', strBytes(html), 'text/html');

            try {
                var pptx = await buildPptx(weekData.pptTitle, weekData.bullets);
                await createFileTopic(ou, moduleId, weekData.pptTitle, slug(weekData.short) + '-lecture.pptx', pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
            } catch (err) {
                logBuild('PPTX topic failed for ' + weekData.short + ': ' + err.message);
            }

            var pdf = buildPdf(weekData.pdfTitle, [weekData.summary, weekData.bullets.join(' / '), 'Dummy reading generated for the Michigan History sandbox course.']);
            await createFileTopic(ou, moduleId, weekData.pdfTitle, slug(weekData.short) + '-reading.pdf', strBytes(pdf), 'application/pdf');

            try {
                var docx = await buildDocx(weekData.docTitle, [
                    weekData.summary,
                    'Instructions: Answer in complete sentences. This worksheet is dummy content.',
                    '1. Summarize the main idea of this week in two sentences.',
                    '2. Name one Michigan place connected to this week and explain why it matters.',
                    '3. What question would you bring to class discussion?'
                ].concat(weekData.bullets));
                await createFileTopic(ou, moduleId, weekData.docTitle, slug(weekData.short) + '-worksheet.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            } catch (err) {
                logBuild('DOCX topic failed for ' + weekData.short + ': ' + err.message);
            }

            await createLinkTopic(ou, moduleId, weekData.youtube.title, weekData.youtube.url);
            await sleep(120);
            } catch (err) {
                logBuild('Week failed (' + weekData.title + '): ' + err.message);
            }
        }
    }

    async function createFileTopic(ou, moduleId, title, fileName, bytes, mime) {
        var topic = {
            Title: title,
            ShortTitle: title.slice(0, 50),
            Type: 1,
            TopicType: 1,
            Url: fileName,
            StartDate: null,
            EndDate: null,
            DueDate: null,
            IsHidden: false,
            IsLocked: false,
            OpenAsExternalResource: null,
            Description: rich(''),
            Duration: null
        };
        var url = '/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/content/modules/' + encodeURIComponent(moduleId) + '/structure/';
        try {
            await postMultipartMixed(url, topic, fileName, bytes, mime);
            logBuild('  Topic: ' + title);
        } catch (err) {
            logBuild('  Topic failed (' + title + '): ' + err.message);
        }
    }

    async function createLinkTopic(ou, moduleId, title, link) {
        var topic = {
            Title: title,
            ShortTitle: title.slice(0, 50),
            Type: 1,
            TopicType: 3,
            Url: link,
            StartDate: null,
            EndDate: null,
            DueDate: null,
            IsHidden: false,
            IsLocked: false,
            OpenAsExternalResource: true,
            Description: rich('<p>Suggested viewing for this dummy week.</p>'),
            Duration: null
        };
        try {
            await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/content/modules/' + encodeURIComponent(moduleId) + '/structure/', { method: 'POST', body: topic });
            logBuild('  Link: ' + title);
        } catch (err) {
            logBuild('  Link failed (' + title + '): ' + err.message);
        }
    }

    async function createDiscussions(ou, specs, grades) {
        var forumName = 'Michigan History Discussions';
        var forumUrl = '/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/discussions/forums/';
        var forumId = null;
        var created = [];

        try {
            var forums = asList(await apiJson(forumUrl));
            var existingForum = findByName(forums, forumName);
            if (existingForum) {
                forumId = extractId(existingForum);
                logBuild('Reusing discussion forum ' + forumId);
            }
        } catch (err) {
            logBuild('Could not list forums: ' + err.message);
        }

        if (!forumId) {
            var forumPayload = {
                Name: forumName,
                Description: richText('<p>Three graded discussion topics for the dummy course. Post while impersonating a dummy student.</p>'),
                ShowDescriptionInTopics: true,
                StartDate: null,
                EndDate: null,
                PostStartDate: null,
                PostEndDate: null,
                AllowAnonymous: false,
                IsLocked: false,
                IsHidden: false,
                RequiresApproval: false,
                MustPostToParticipate: false,
                DisplayInCalendar: false,
                DisplayPostDatesInCalendar: false
            };
            try {
                var forum = await postJsonWithFallback(forumUrl, forumPayload, [
                    function (body) { return { ForumData: body }; }
                ]);
                forumId = extractId(forum);
                logBuild('Created discussion forum ' + forumId);
            } catch (err) {
                logBuild('Forum create failed: ' + err.message);
                return created;
            }
        }

        if (!forumId) {
            logBuild('No forum Id returned; skipping discussion topics.');
            return created;
        }

        var existingTopics = [];
        try {
            existingTopics = asList(await apiJson(forumUrl + encodeURIComponent(forumId) + '/topics/'));
        } catch (err) {
            logBuild('Could not list discussion topics: ' + err.message);
        }

        for (var i = 0; i < specs.length; i += 1) {
            var spec = specs[i];
            var reused = findByName(existingTopics, spec.name);
            if (reused) {
                created.push({ forumId: forumId, topicId: extractId(reused), name: spec.name });
                logBuild('Reusing discussion: ' + spec.name);
                continue;
            }
            var payload = {
                Name: spec.name,
                Description: rich(spec.prompt),
                AllowAnonymousPosts: false,
                StartDate: null,
                EndDate: null,
                IsHidden: false,
                UnlockStartDate: null,
                UnlockEndDate: null,
                RequiresApproval: false,
                ScoreOutOf: spec.points,
                IsAutoScore: false,
                IncludeNonScoredValues: false,
                ScoringType: null,
                IsLocked: false,
                MustPostToParticipate: true,
                RatingType: 0,
                DisplayInCalendar: false,
                DisplayUnlockDatesInCalendar: false,
                GroupTypeId: null
            };
            try {
                var topic = await postJsonWithFallback(
                    forumUrl + encodeURIComponent(forumId) + '/topics/',
                    payload,
                    [
                        function (body) {
                            return {
                                Name: body.Name,
                                Description: body.Description,
                                AllowAnonymousPosts: false,
                                StartDate: null,
                                EndDate: null,
                                IsHidden: false,
                                UnlockStartDate: null,
                                UnlockEndDate: null,
                                RequiresApproval: false,
                                ScoreOutOf: body.ScoreOutOf,
                                IsAutoScore: false,
                                IncludeNonScoredValues: false,
                                ScoringType: null,
                                IsLocked: false,
                                MustPostToParticipate: true
                            };
                        },
                        function (body) { return { CreateTopicData: body }; },
                        function (body) { return { TopicData: body }; }
                    ]
                );
                created.push({ forumId: forumId, topicId: extractId(topic), name: spec.name });
                logBuild('Discussion: ' + spec.name + (gradeIdByKey(grades, spec.gradeName) ? '' : ' (no matching grade item)'));
            } catch (err) {
                logBuild('Discussion failed (' + spec.name + '): ' + err.message);
            }
            await sleep(80);
        }
        return created;
    }

    async function createDropboxes(ou, specs, grades) {
        var created = [];
        var url = '/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/dropbox/folders/';
        var existing = [];
        try {
            existing = asList(await apiJson(url));
        } catch (err) {
            logBuild('Could not list dropboxes: ' + err.message);
        }
        for (var i = 0; i < specs.length; i += 1) {
            var spec = specs[i];
            var reused = findByName(existing, spec.name);
            if (reused) {
                created.push({ id: extractId(reused), name: spec.name, fileStub: spec.fileStub });
                logBuild('Reusing dropbox: ' + spec.name);
                continue;
            }
            var payload = {
                CategoryId: null,
                Name: spec.name,
                CustomInstructions: rich(spec.instructions),
                Availability: null,
                GroupTypeId: null,
                DueDate: null,
                DisplayInCalendar: false,
                NotificationEmail: null,
                IsHidden: false,
                Assessment: { ScoreDenominator: spec.points },
                GradeItemId: gradeIdByKey(grades, spec.gradeName)
            };
            try {
                var folder = await postJsonWithFallback(url, payload, [
                    function (body) { return { DropboxFolderUpdateData: body }; }
                ]);
                created.push({ id: extractId(folder), name: spec.name, fileStub: spec.fileStub });
                logBuild('Dropbox: ' + spec.name);
            } catch (err) {
                logBuild('Dropbox failed (' + spec.name + '): ' + err.message);
            }
            await sleep(80);
        }
        return created;
    }

    function quizPayload(spec, grades, index, extras) {
        var extra = extras || {};
        var textType = extra.textType || 'Html';
        var gradeId = gradeIdByKey(grades, spec.gradeName);
        var payload = {
            Name: spec.name,
            IsActive: true,
            SortOrder: index + 1,
            AutoExportToGrades: gradeId != null,
            GradeItemId: gradeId,
            IsAutoSetGraded: true,
            Instructions: quizRich(spec.instructions, true, textType),
            Description: quizRich('<p>Questions are not created by the API. Import the matching CSV from Tab 2 into Question Library, then add the questions to this quiz.</p>', true, textType),
            StartDate: null,
            EndDate: null,
            DueDate: null,
            DisplayInCalendar: false,
            NumberOfAttemptsAllowed: 2,
            LateSubmissionInfo: { LateSubmissionOption: 0, LateLimitMinutes: null },
            SubmissionTimeLimit: { IsEnforced: false, ShowClock: false, TimeLimitValue: 0 },
            SubmissionGracePeriod: extra.gracePeriod === undefined ? null : extra.gracePeriod,
            Password: null,
            Header: quizRich('', false, extra.emptyType || 'Text'),
            Footer: quizRich('', false, extra.emptyType || 'Text'),
            AllowHints: false,
            DisableRightClick: false,
            DisablePagerAndAlerts: false,
            NotificationEmail: null,
            CalcTypeId: 1,
            RestrictIPAddressRange: extra.ipRange === undefined ? null : extra.ipRange,
            CategoryId: extra.categoryId === undefined ? null : extra.categoryId,
            PreventMovingBackwards: false,
            Shuffle: false,
            AllowOnlyUsersWithSpecialAccess: false,
            IsRetakeIncorrectOnly: false
        };
        if (extra.includePaging) {
            payload.PagingTypeId = 0;
            payload.IsSynchronous = false;
        }
        return payload;
    }

    async function createQuizzes(ou, specs, grades) {
        var created = [];
        var urls = [
            '/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/quizzes/',
            '/d2l/api/le/1.67/' + encodeURIComponent(ou) + '/quizzes/',
            '/d2l/api/le/1.51/' + encodeURIComponent(ou) + '/quizzes/'
        ];
        var existing = [];
        try {
            existing = asList(await apiJson(urls[0]));
        } catch (err) {
            logBuild('Could not list quizzes: ' + err.message);
        }
        for (var i = 0; i < specs.length; i += 1) {
            var spec = specs[i];
            var reused = findByName(existing, spec.name);
            if (reused) {
                created.push({ id: extractId(reused), name: spec.name, csvName: spec.csvName });
                logBuild('Reusing quiz: ' + spec.name);
                continue;
            }
            var variants = [
                quizPayload(spec, grades, i, {}),
                quizPayload(spec, grades, i, { includePaging: true }),
                quizPayload(spec, grades, i, { textType: 'HTML' })
            ];
            var quiz = null;
            var lastError = null;
            variantLoop:
            for (var u = 0; u < urls.length; u += 1) {
                for (var v = 0; v < variants.length; v += 1) {
                    try {
                        if (u || v) logBuild('Retrying quiz POST (' + spec.name + ')…');
                        quiz = await apiJson(urls[u], { method: 'POST', body: variants[v] });
                        break variantLoop;
                    } catch (err) {
                        lastError = err;
                    }
                }
            }
            if (!quiz) {
                try {
                    quiz = await apiJson(urls[0], { method: 'POST', body: { QuizData: variants[0] } });
                } catch (err) {
                    lastError = err;
                }
            }
            if (quiz) {
                created.push({ id: extractId(quiz), name: spec.name, csvName: spec.csvName });
                logBuild('Quiz (no questions): ' + spec.name);
            } else {
                logBuild('Quiz failed (' + spec.name + '): ' + (lastError && lastError.message ? lastError.message : lastError));
            }
            await sleep(80);
        }
        return created;
    }

    function renderBuildResult(result, restored) {
        el.buildResult.style.display = 'block';
        var students = (result.students || []).map(function (s) { return s.userName; }).join(', ') || '—';
        el.buildResultGrid.innerHTML =
            resultCell('OrgUnitId', result.orgUnitId) +
            resultCell('Course', result.courseName) +
            resultCell('Code', result.courseCode) +
            resultCell('Dummy students', students) +
            resultCell('Grade items', (result.grades || []).length) +
            resultCell('Discussions', (result.discussions || []).length) +
            resultCell('Dropboxes', (result.dropboxes || []).length) +
            resultCell('Quizzes', (result.quizzes || []).length) +
            resultCell(restored ? 'Restored' : 'Built', result.builtAt || '');
    }

    function resultCell(label, value) {
        return '<div><div class="label">' + xmlEscape(label) + '</div><div class="value">' + xmlEscape(value) + '</div></div>';
    }

    /* ------------------------------------------------------------------ */
    /* Tab 2                                                               */
    /* ------------------------------------------------------------------ */

    async function loadPackageContext() {
        var ou = (el.packageOu.value || '').trim() || (lastBuild && lastBuild.orgUnitId);
        if (!ou) {
            logPackage('Enter an OrgUnitId (or run Tab 1 first).');
            return;
        }
        if (typeof D2LApi === 'undefined') {
            logPackage('ERROR: D2LApi is not loaded.');
            return;
        }
        el.loadPackageBtn.disabled = true;
        logPackage('Loading course ' + ou + '…');
        try {
            var course = await apiJson('/d2l/api/lp/' + LP + '/courses/' + encodeURIComponent(ou));
            var students = [];
            try {
                var classlist = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/classlist/'));
                students = classlist.filter(function (u) {
                    var name = String(u.UserName || u.OrgDefinedId || '');
                    var role = u.RoleId || (u.Role && u.Role.Id);
                    return name.indexOf('ZZSandbox') !== -1 || String(role) === String(DEMO_ROLE);
                }).map(function (u) {
                    return {
                        userId: u.Identifier || u.UserId,
                        userName: u.UserName,
                        firstName: u.FirstName,
                        lastName: u.LastName,
                        displayName: ((u.FirstName || '') + ' ' + (u.LastName || '')).trim()
                    };
                });
            } catch (err) {
                logPackage('Classlist read failed, using Tab 1 student list: ' + err.message);
                students = (lastBuild && lastBuild.students) || [];
            }

            var dropboxes = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/dropbox/folders/')).map(function (f) {
                return { id: f.Id || f.FolderId, name: f.Name };
            });
            var discussions = [];
            var forums = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/discussions/forums/'));
            for (var i = 0; i < forums.length; i += 1) {
                var forumId = forums[i].ForumId || forums[i].Id;
                var topics = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/discussions/forums/' + encodeURIComponent(forumId) + '/topics/'));
                topics.forEach(function (t) {
                    discussions.push({ forumId: forumId, topicId: t.TopicId || t.Id, name: t.Name });
                });
            }
            var quizzes = asList(await apiJson('/d2l/api/le/' + LE + '/' + encodeURIComponent(ou) + '/quizzes/')).map(function (q) {
                return { id: q.QuizId || q.Id, name: q.Name };
            });

            packageContext = {
                orgUnitId: ou,
                courseName: course.Name,
                courseCode: course.Code,
                students: students,
                dropboxes: dropboxes,
                discussions: discussions,
                quizzes: quizzes
            };
            el.downloadZipBtn.disabled = false;
            el.packageSummary.innerHTML =
                '<strong>' + xmlEscape(course.Name) + '</strong> (' + xmlEscape(course.Code) + ')<br>' +
                'Dummy students: ' + xmlEscape(students.map(function (s) { return s.userName || s.displayName; }).join(', ') || 'none found') + '<br>' +
                'Dropboxes: ' + dropboxes.length + ' · Discussions: ' + discussions.length + ' · Quizzes: ' + quizzes.length +
                '<br>Quiz questions still cannot be posted via API. The zip includes Brightspace CSV files (5 questions per quiz).';
            logPackage('Loaded. Students ' + students.length + ', dropboxes ' + dropboxes.length + ', discussions ' + discussions.length + ', quizzes ' + quizzes.length + '.');
        } catch (err) {
            logPackage('ERROR: ' + err.message);
        } finally {
            el.loadPackageBtn.disabled = false;
        }
    }

    function studentVoice(name) {
        var lower = String(name || '').toLowerCase();
        if (lower.indexOf('marquette') !== -1) return 'up';
        if (lower.indexOf('lansing') !== -1) return 'mid';
        return 'careful';
    }

    function dropboxEssay(student, dropboxName, voice) {
        var who = (student.firstName || 'Student') + ' ' + (student.lastName || '');
        var intros = {
            careful: who + ' writes with complete sentences and cites course themes.',
            mid: who + ' turns in a solid, slightly informal draft.',
            up: who + ' writes from an Upper Peninsula point of view and keeps it shorter.'
        };
        var bodies = {
            careful: [
                'This assignment asks us to connect a Michigan place to a longer story, not just a famous date.',
                'I keep coming back to water: the lakes made trade, migration, and industry possible, and they also made conflict possible.',
                'If this were a real class, I would want a primary source next — a letter, a map, or a union flyer — so the argument is not only from the overview pages.',
                'Submitted as dummy student work for ' + dropboxName + '.'
            ],
            mid: [
                'I think this week is about how Michigan kept changing jobs: fur, then lumber and mining, then cars.',
                'Detroit gets most of the attention but the U.P. and the farms matter too. Without the Soo Locks the copper and iron do not move.',
                'My main point is that the map of Michigan is an economic map as much as a political one.',
                'Dummy submission for ' + dropboxName + '.'
            ],
            up: [
                'From Marquette it is easier to see extraction than auto plants. Copper, iron, and shipping through the Soo still explain the skyline.',
                'Statehood looks different from the peninsula that was the consolation prize in the Toledo fight.',
                'The lakes are not a backdrop. They are the reason towns exist here.',
                'Dummy submission for ' + dropboxName + '.'
            ]
        };
        return [who + ' — ' + dropboxName, intros[voice] || intros.careful].concat(bodies[voice] || bodies.careful);
    }

    function discussionPost(student, topicName, voice) {
        var who = student.firstName || 'Student';
        if (voice === 'up') {
            return who + ' — ' + topicName + '\n\nI am writing this as a dummy student from the U.P. side of the story. Water and extraction are not abstract here. The course overview made me think about who got written into "Michigan history" and who was treated as scenery.\n\n(Dummy discussion post for impersonation practice.)';
        }
        if (voice === 'mid') {
            return who + ' — ' + topicName + '\n\nMy take is that Michigan history is a series of jobs stacked on the lakes: fur, lumber, mining, cars. I want to hear how classmates from other parts of the state would tell the same timeline.\n\n(Dummy discussion post for impersonation practice.)';
        }
        return who + ' — ' + topicName + '\n\nThe name Michigan already argues that water is the main character. I would like this class to treat Anishinaabe history as the start of the story, not a preface, and then watch how later industry reused the same waterways.\n\n(Dummy discussion post for impersonation practice.)';
    }

    async function downloadStudentZip() {
        if (!window.JSZip) {
            logPackage('JSZip did not load.');
            return;
        }
        if (!packageContext) {
            logPackage('Load the course first.');
            return;
        }
        el.downloadZipBtn.disabled = true;
        logPackage('Building zip…');
        try {
            var zip = new JSZip();
            var data = curriculum();
            var ctx = packageContext;
            var students = ctx.students && ctx.students.length ? ctx.students : (lastBuild && lastBuild.students) || [];
            if (!students.length) {
                students = data.students.map(function (s) {
                    return { firstName: s.firstName, lastName: s.lastName, userName: 'ZZSandbox-' + s.firstName };
                });
            }

            var readme = [
                'Michigan History dummy course — student work package',
                'Course: ' + (ctx.courseName || '') + ' (OU ' + ctx.orgUnitId + ')',
                '',
                'The Brightspace API cannot submit dropbox files or discussion posts as another user,',
                'and it cannot create quiz questions. This zip is the workaround.',
                '',
                '1. Classlist > impersonate Ada / Lansing / Marquette ZZSandbox.',
                '2. Upload that student\'s dropbox/*.docx files to the matching assignment.',
                '3. Copy discussions/*.txt into the matching discussion topic.',
                '4. Stop impersonating.',
                '5. Quizzes > Question Library > Import each CSV (or ALL-QUIZZES.csv).',
                '6. Add those questions to the matching quiz.',
                '',
                'Students:',
                students.map(function (s) { return ' - ' + (s.userName || '') + ' | ' + (s.firstName || '') + ' ' + (s.lastName || ''); }).join('\n'),
                '',
                'Dropboxes:',
                (ctx.dropboxes || []).map(function (d) { return ' - ' + d.name; }).join('\n'),
                '',
                'Discussions:',
                (ctx.discussions || []).map(function (d) { return ' - ' + d.name; }).join('\n'),
                '',
                'Quizzes:',
                (ctx.quizzes || []).map(function (q) { return ' - ' + q.name; }).join('\n')
            ].join('\n');
            zip.file('README.txt', readme);

            var quizFolder = zip.folder('quiz-questions');
            var allCsv = [];
            data.quizzes.forEach(function (quiz) {
                var csv = questionsToCsv(quiz.name, quiz.questions);
                quizFolder.file(quiz.csvName, csv);
                allCsv.push(csv);
            });
            quizFolder.file('ALL-QUIZZES.csv', allCsv.join('\r\n'));

            var dropboxes = (ctx.dropboxes && ctx.dropboxes.length) ? ctx.dropboxes : data.dropboxes;
            var discussions = (ctx.discussions && ctx.discussions.length) ? ctx.discussions : data.discussions;

            for (var s = 0; s < students.length; s += 1) {
                var student = students[s];
                var folderName = 'students/' + slug((student.firstName || 'student') + '-' + (student.lastName || 'zzsandbox'));
                var voice = studentVoice(student.firstName || student.userName);
                var dbFolder = zip.folder(folderName + '/dropbox');
                for (var d = 0; d < dropboxes.length; d += 1) {
                    var db = dropboxes[d];
                    var paras = dropboxEssay(student, db.name, voice);
                    var bytes = await buildDocx(db.name, paras);
                    var stub = db.fileStub || slug(db.name);
                    dbFolder.file(stub + '.docx', bytes);
                }
                var discFolder = zip.folder(folderName + '/discussions');
                discussions.forEach(function (topic) {
                    discFolder.file(slug(topic.name) + '.txt', discussionPost(student, topic.name, voice));
                });
            }

            var blob = await zip.generateAsync({ type: 'blob' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'MI-History-dummy-student-work-' + ctx.orgUnitId + '.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            logPackage('Downloaded zip. Impersonate each dummy student to upload dropbox and discussion files, then import the CSVs into Question Library.');
        } catch (err) {
            logPackage('ERROR: ' + err.message);
        } finally {
            el.downloadZipBtn.disabled = false;
        }
    }
})();
