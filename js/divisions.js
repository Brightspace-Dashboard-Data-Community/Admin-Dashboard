// Global variable to store division details
let divisionDetails = [];

/**
 * Renders the modal with division information
 * @param {Object} data - The division data object
 */
function renderModal(data) {
  const body = document.getElementById("modalBody");
  
  // Configuration for section placement and order
  // Format: [column, order] where:
  // - column: 1 = left column, 2 = right column
  // - order: lower numbers appear first within their column
  const sectionLayout = {
    contactInfo: [1, 10],     // Contact information in left column, order 10
    associateDean: [2, 20],   // Associate Dean in right column, order 20
    officeProfs: [2, 10],     // Office Professionals in right column, order 10
    coordinators: [1, 20]     // Coordinators in left column, order 20
  };
  
  // Create section objects to organize content
  const sections = {
    contactInfo: {
      id: 'contactInfo',
      title: 'Contact Information',
      content: `
        <p class="contact-details"><strong>Main Office:</strong> <span class="contact-icon">📍</span>${data["Main Office Location"] || 'N/A'}</p>
        <p class="contact-details"><strong>Phone:</strong> <span class="contact-icon">☎️</span>${data["Phone Number"] || 'N/A'}</p>
        <p class="contact-details"><strong>Email:</strong> <span class="contact-icon">📧</span><a href="mailto:${data["Email"]}">${data["Email"] || 'N/A'}</a></p>
      `
    },
    associateDean: {
      id: 'associateDean',
      title: 'Associate Dean',
      content: data["Associate Dean"] ? `
        <p><strong>${data["Associate Dean"]}</strong></p>
        ${data["AD Email"] ? `<p><span class="contact-icon">📧</span><a href="mailto:${data["AD Email"]}">${data["AD Email"]}</a></p>` : ''}
        ${data["AD Office"] ? `<p><span class="contact-icon">📍</span>${data["AD Office"]}</p>` : ''}
        ${data["AD Number"] ? `<p><span class="contact-icon">☎️</span>${data["AD Number"]}</p>` : ''}
      ` : ''
    },
    officeProfs: {
      id: 'officeProfs',
      title: 'Office Professionals',
      content: data["Office Professional"] ? (() => {
        const names = data["Office Professional"].split(";");
        const emails = (data["OP Email"] || "").split(";");
        const offices = (data["OP Office"] || "").split(";");
        const phones = (data["OP Number"] || "").split(";");
        
        let content = '<ul>';
        names.forEach((name, i) => {
          content += `<li><strong>${name.trim()}</strong>`;
          
          const contactInfo = [];
          if (emails[i]) contactInfo.push(`<span class="contact-icon">📧</span><a href="mailto:${emails[i].trim()}">${emails[i].trim()}</a>`);
          if (offices[i]) contactInfo.push(`<span class="contact-icon">📍</span>${offices[i].trim()}`);
          if (phones[i]) contactInfo.push(`<span class="contact-icon">☎️</span>${phones[i].trim()}`);
          
          if (contactInfo.length > 0) {
            content += `<br>${contactInfo.join(' • ')}`;
          }
          
          content += "</li>";
        });
        content += "</ul>";
        return content;
      })() : ''
    },
    coordinators: {
      id: 'coordinators',
      title: 'Coordinators',
      content: data["Coordinator Name(s)"] ? (() => {
        const names = data["Coordinator Name(s)"].split(";");
        const emails = (data["Coordinator Email(s)"] || "").split(";");
        
        let content = '<ul>';
        names.forEach((name, i) => {
          content += `<li><strong>${name.trim()}</strong>`;
          if (emails[i]) {
            content += `<br><span class="contact-icon">📧</span><a href="mailto:${emails[i].trim()}">${emails[i].trim()}</a>`;
          }
          content += "</li>";
        });
        content += "</ul>";
        return content;
      })() : ''
    }
  };
  
  // Group and sort sections by column and order
  const columnSections = {
    1: [], // left column sections
    2: []  // right column sections
  };
  
  // Organize sections by column and sort by order
  Object.entries(sections).forEach(([key, section]) => {
    const [column, order] = sectionLayout[key];
    if (section.content) {
      columnSections[column].push({
        ...section,
        order
      });
    }
  });
  
  // Sort sections within each column by order
  columnSections[1].sort((a, b) => a.order - b.order);
  columnSections[2].sort((a, b) => a.order - b.order);
  
  // Start building the HTML with header
  let html = `
    <div class="modal-grid">
      <div class="modal-header">
        <h2>${data.Division}</h2>
      </div>
      
      <div class="modal-left-column">
  `;
  
  // Add all sections for left column in sorted order
  columnSections[1].forEach(section => {
    html += `
      <div class="modal-section" id="section-${section.id}">
        <h3>${section.title}</h3>
        ${section.content}
      </div>
    `;
  });
  
  // Close left column and open right column
  html += `
      </div>
      <div class="modal-right-column">
  `;
  
  // Add all sections for right column in sorted order
  columnSections[2].forEach(section => {
    html += `
      <div class="modal-section" id="section-${section.id}">
        <h3>${section.title}</h3>
        ${section.content}
      </div>
    `;
  });
  
  // Close right column and grid
  html += `
      </div>
    </div>
  `;
  
  body.innerHTML = html;
  document.getElementById("divisionModal").style.display = "block";
}

/**
 * Loads programs data from CSV and initializes the table
 */
function loadPrograms() {
  const tableBody = $("#programTable tbody");
  
  // Determine the correct path based on current page location
  const csvPath = window.location.pathname.includes('/info/') ? "programs.csv" : "info/programs.csv";
  
  Papa.parse(csvPath, {
    download: true,
    header: true,
    complete: function(results) {
      const data = results.data;
      const divisionFilter = $("#divisionFilter");
      const subjectFilter = $("#subjectFilter");
      let divisions = new Set();
      let subjects = new Set();

      // In your loadPrograms function, update the row creation:
      data.forEach(item => {
        if (item.Division && item["Subject/Discipline"] && item.Prefix) {
          tableBody.append(`
            <tr class="program-row" data-prefix="${item.Prefix}">
              <td class="division-cell" data-division="${item.Division}">${item.Division}</td>
              <td>${item["Subject/Discipline"]}</td>
              <td class="prefix-cell" data-prefix="${item.Prefix}">${item.Prefix}</td>
            </tr>
          `);
          divisions.add(item.Division);
          subjects.add(item["Subject/Discipline"]);
        }
      });

      // After creating the DataTable, add this event handler:
      $('#programTable tbody').on("click", ".prefix-cell", function() {
        const prefix = $(this).data("prefix");
        const row = $(this).closest('tr');
        loadCoursesForPrefix(prefix, row);
      });

      // Populate filter dropdowns
      [...divisions].sort().forEach(d => divisionFilter.append(`<option value="${d}">${d}</option>`));
      [...subjects].sort().forEach(s => subjectFilter.append(`<option value="${s}">${s}</option>`));

      // Initialize DataTable
      const table = $('#programTable').DataTable();
      
      table.on('draw', function() {
        // Close any open course details when table is redrawn
        $('.course-details').remove();
        $('.prefix-cell').removeClass('expanded');
      });

      // Add click event for division cells
      $('#programTable tbody').on("click", ".division-cell", function() {
        const division = $(this).data("division");
        const divisionLower = division.toLowerCase().trim();
        
        // Find case-insensitive match for division
        const match = divisionDetails.find(d => 
          d.Division && d.Division.toLowerCase().trim() === divisionLower
        );
        
        if (match) {
          renderModal(match);
        } else {
          console.log("No match found for division:", division);
          console.log("Available divisions:", divisionDetails.map(d => d.Division));
        }
      });

      // Add filter change events
      divisionFilter.on('change', function () {
        const val = $.fn.dataTable.util.escapeRegex($(this).val());
        table.column(0).search(val ? '^' + val + '$' : '', true, false).draw();
      });

      subjectFilter.on('change', function () {
        const val = $.fn.dataTable.util.escapeRegex($(this).val());
        table.column(1).search(val ? '^' + val + '$' : '', true, false).draw();
      });
    }
  });
}

/**
 * Loads courses for a specific prefix and displays them in an expandable row
 */
function loadCoursesForPrefix(prefix, row) {
  // Get or create the container for course details
  let detailsRow = row.next('.course-details');
  
  // If it exists and is visible, we're closing it
  if (detailsRow.length && detailsRow.is(':visible')) {
    detailsRow.slideUp(300);
    row.find('.prefix-cell').removeClass('expanded');
    return;
  }
  
  // If it exists but is hidden, we'll show it again
  if (detailsRow.length) {
    detailsRow.slideDown(300);
    row.find('.prefix-cell').addClass('expanded');
    return;
  }
  
  // Create a new details row if it doesn't exist
  detailsRow = $(`<tr class="course-details"><td colspan="3"><div class="loading-indicator">Loading courses for ${prefix}...</div></td></tr>`);
  row.after(detailsRow);
  
  // Show the new row
  row.find('.prefix-cell').addClass('expanded');
  
  // Determine the correct path based on current page location
  const coursesPath = window.location.pathname.includes('/info/') ? "courses2.csv" : "info/courses2.csv";
  
  // Load the courses data
  Papa.parse(coursesPath, {
    download: true,
    header: true,
    complete: function(results) {
      const courses = results.data.filter(course => course.Prefix === prefix);
      
      let content;
      if (courses.length === 0) {
        content = `<div class="no-courses">No courses found for ${prefix}.</div>`;
      } else {
        // Create a nice table of courses
        content = `
          <table class="course-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Title</th>
                <th>Credits</th>
              </tr>
            </thead>
            <tbody>
        `;
        
        courses.forEach(course => {
          content += `
            <tr>
              <td>${course.Prefix} ${course.CourseNumber}</td>
              <td>${course.Title || 'N/A'}</td>
              <td>${course.Credits || 'N/A'}</td>
            </tr>
          `;
        });
        
        content += `
            </tbody>
          </table>
        `;
      }
      
      // Update the details row with the content
      detailsRow.find('td').html(content);
      
      // Ensure the row is visible (in case of quick clicking)
      detailsRow.slideDown(300);
    },
    error: function() {
      detailsRow.find('td').html(`<div class="error">Failed to load courses for ${prefix}.</div>`);
    }
  });
}

/**
 * Initializes the application
 */
$(document).ready(function () {
  // Determine the correct path based on current page location
  const detailsPath = window.location.pathname.includes('/info/') ? "division_details.csv" : "info/division_details.csv";
  
  // Load division details first
  Papa.parse(detailsPath, {
    download: true,
    header: true,
    complete: function(results) {
      divisionDetails = results.data;
      
      // Then load programs
      loadPrograms();
    }
  });

  // Modal close events
  $(".close").on("click", () => $("#divisionModal").hide());
  $(window).on("click", function (e) {
    if (e.target.id === "divisionModal") $("#divisionModal").hide();
  });
});
