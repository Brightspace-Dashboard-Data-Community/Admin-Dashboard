# Office Hours — Content topic

The earlier embed iframe caused **Page Not Found** because it tried to load a file from org Manage Files that is not there.

Use **one paste**. The Content topic HTML *is* the app. There is no second file to host.

## Fix the topic you already have

1. In the course, open **Office Hours Chat → office-hours-chat-page**.
2. **Actions → Edit HTML** (or Edit).
3. Switch to **HTML Source** (not the visual editor).
4. Select all and delete the old embed (`Live Office Hours` toolbar + iframe).
5. Paste the **entire** contents of `office-hours-chat-content-topic.html`.
6. Save, then view the topic.

You should see **Loading Office Hours…** and then the instructor or student chat UI. You should **not** see Page Not Found.

## First-time setup

Open the topic once as the instructor. That creates a discussion forum named **Live Office Hours (system)**. Students can then join the waiting room.

## Do not

- Do not iframe `/content/CustomWidgets/office-hours-chat/office-hours-chat-page.html`
- Do not paste `office-hours-chat-content-topic.html` *and* also iframe the page file
- Do not switch back to the visual editor before saving (it can strip the script)

## Optional: upload as a file instead

If you prefer not to paste HTML, **Create New → Upload File** and upload `office-hours-chat-page.html`. Then delete the old embed topic.

The homepage widget is a separate product and is not required.
