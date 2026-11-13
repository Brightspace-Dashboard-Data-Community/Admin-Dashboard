/**
 * Email Templates — render and mailto launch for Faculty Success Path.
 */

const FacultyEmailTemplates = {
    _templates: null,

    async loadTemplates() {
        if (this._templates) return this._templates;
        const base = typeof FacultyRecordService !== 'undefined'
            ? FacultyRecordService.getConfigBasePath()
            : 'faculty-onboarding/';
        try {
            const resp = await fetch(`${base}config/email-templates.json`, { credentials: 'same-origin' });
            const data = await resp.json();
            this._templates = data.templates || {};
        } catch (e) {
            console.warn('FacultyEmailTemplates: failed to load config', e);
            this._templates = {};
        }
        return this._templates;
    },

    getTemplateKeys() {
        return Object.keys(this._templates || {});
    },

    getSettings() {
        const svc = typeof FacultyRecordService !== 'undefined' ? FacultyRecordService : {};
        return svc._settings || {
            loginUrl: 'https://your-brightspace.example.edu',
            elearningContactEmail: 'elearning@example.edu'
        };
    },

    render(templateKey, record) {
        const templates = this._templates || {};
        const tpl = templates[templateKey];
        if (!tpl) return { to: '', subject: '', body: '' };

        const settings = this.getSettings();
        const vars = {
            firstName: record.firstName || '',
            lastName: record.lastName || '',
            username: record.username || '',
            orgDefinedId: record.orgDefinedId || '',
            email: record.email || '',
            assignedSpecialist: record.assignedSpecialist || 'eLearning Office',
            firstTeachingSemester: record.firstTeachingSemester || 'your upcoming semester',
            loginUrl: settings.loginUrl || 'https://your-brightspace.example.edu',
            elearningEmail: settings.elearningContactEmail || 'elearning@example.edu'
        };

        const replace = (text) =>
            String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');

        const to = record.email || '';
        const subject = replace(tpl.subject);
        const body = replace(tpl.body);
        return { to, subject, body, label: tpl.label || templateKey };
    },

    /**
     * Launch Outlook (or the default mail client) via mailto.
     * Do not use window.open(..., 'noopener,noreferrer'): Chrome returns null for
     * mailto: and often never hands off to the mail client. An <a> click is a
     * navigation, not a popup, so it works inside D2L the same way as the
     * Incomplete Students tool when that tool's window.open check is skipped.
     */
    openMailto(mailtoUrl) {
        const a = document.createElement('a');
        a.href = mailtoUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    },

    openInOutlook(to, subject, body) {
        const rawTo = (to || '').trim();
        const rawSubj = (subject || '').trim();
        const rawBody = (body || '').trim();

        if (!rawTo && !rawSubj && !rawBody) {
            alert('Generate the email first, then click Open in Outlook.');
            return;
        }

        const encodedTo = encodeURIComponent(rawTo);
        const encodedSubj = encodeURIComponent(rawSubj);
        const encodedBody = encodeURIComponent(rawBody);
        const maxUrlLen = 2000;
        let url = `mailto:${encodedTo}?subject=${encodedSubj}&body=${encodedBody}`;
        const bodyTooLong = url.length > maxUrlLen;

        if (bodyTooLong) {
            url = `mailto:${encodedTo}?subject=${encodedSubj}`;
        }

        // Must run in the same click turn. Clipboard after open is fine;
        // clipboard-then-open is treated as a blocked popup.
        this.openMailto(url);

        if (bodyTooLong) {
            const copied = navigator.clipboard?.writeText
                ? navigator.clipboard.writeText(rawBody)
                : Promise.reject();
            copied.then(() => {
                alert('Opened Outlook with To and Subject. The body was copied to your clipboard — paste it into the email.');
            }).catch(() => {
                alert('Opened Outlook with To and Subject. The body was too long for the link — copy it from the text area.');
            });
        }
    },

    async copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        return false;
    }
};

if (typeof window !== 'undefined') {
    window.FacultyEmailTemplates = FacultyEmailTemplates;
}
