/**
 * create-user.js
 * Handles user creation functionality for the Create User page
 * Based on old-Admin-Dashboard/js/create-user.js
 */

// Import the BrightspaceFetch function
async function BrightspaceFetch(endpoint, method = "GET", body = null) {
    const token = localStorage.getItem("XSRF.Token");
    
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    
    if (token) {
        headers["X-CSRF-Token"] = token;
    }

    const options = { 
        method, 
        headers,
        credentials: "include"
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(endpoint, options);
        
        // Check for XSRF token in response headers
        const newToken = response.headers.get('x-csrf-token');
        if (newToken && newToken !== token) {
            localStorage.setItem("XSRF.Token", newToken);
        }

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API Error: ${response.status} - ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.Message) {
                    errorMessage = errorJson.Message;
                } else if (errorJson.message) {
                    errorMessage = errorJson.message;
                }
            } catch (e) {
                // If not JSON, use the text
                if (errorText) {
                    errorMessage = errorText;
                }
            }
            throw new Error(errorMessage);
        }

        // Check if response is empty
        const text = await response.text();
        if (!text || text.trim() === '') {
            return {};
        }

        // Try to parse as JSON
        try {
            return JSON.parse(text);
        } catch (jsonError) {
            return text;
        }
    } catch (error) {
        console.error("Error fetching API:", error.message);
        throw error;
    }
}

// Track if form has been initialized to prevent duplicate listeners
let formInitialized = false;
let lastCreatedUserId = null;

// Initialize the create user form
function initializeCreateUserForm() {
    // Prevent duplicate initialization
    if (formInitialized) {
        console.log("Form already initialized, skipping...");
        return;
    }
    
    // Try multiple selectors to find the form
    let createUserForm = document.getElementById('create-user-form');
    if (!createUserForm) createUserForm = document.querySelector('form.form-container-inner');
    if (!createUserForm) createUserForm = document.querySelector('form.form-container');
    
    if (!createUserForm) {
        console.error("Create user form not found. Available elements:", {
            forms: document.querySelectorAll('form').length,
            formContainers: document.querySelectorAll('.form-container').length,
            body: document.body ? 'exists' : 'missing'
        });
        return;
    }
    
    // Check if form already has event listener
    if (createUserForm.hasAttribute('data-initialized')) {
        console.log("Form already has event listener attached");
        formInitialized = true;
        return;
    }
    
    console.log("Create user form found:", createUserForm);
    createUserForm.setAttribute('data-initialized', 'true');
    formInitialized = true;

    // After-create UI elements
    const resultSection = document.getElementById('create-result-section');
    const resultOutput = document.getElementById('create-user-result');
    const editUserLink = document.getElementById('d2l-edit-user-link');
    const enrollCourseInput = document.getElementById('enroll-course-id');
    const enrollRoleInput = document.getElementById('enroll-role-id');
    const enrollCourseBtn = document.getElementById('enroll-course-btn');
    const enrollCourseResult = document.getElementById('enroll-course-result');

    createUserForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Get form values
        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const email = document.getElementById('email').value.trim() || null;
        const username = document.getElementById('username').value.trim();
        const userRole = document.getElementById('role').value;
        const status = document.getElementById('status').value;
        const sendEmail = document.getElementById('sendEmail').checked;
        let userNumber = document.getElementById('userNumber').value.trim();

        // Convert userNumber to a number if valid, otherwise set to null
        userNumber = userNumber && !isNaN(userNumber) ? userNumber : null;

        // Validate form
        if (!firstName || !lastName || !username || !userRole) {
            alert('Please fill in all required fields');
            console.error("Validation Error: Missing required fields.");
            return;
        }

        // Map RoleId to numerical values required by D2L API
        const roleIdMap = {
            student: 101,
            instructor: 102,
            admin: 100,
            studentView: 112
        };

        const roleId = roleIdMap[userRole];

        if (!roleId) {
            alert("Invalid user role selected.");
            return;
        }

        // Construct user data for API
        const userData = {
            OrgDefinedId: userNumber, // Must be a number or null
            FirstName: firstName,
            MiddleName: null,
            LastName: lastName,
            ExternalEmail: email,
            UserName: username,
            RoleId: roleId,
            IsActive: status === "active",
            SendCreationEmail: sendEmail,
            Pronouns: null
        };

        console.log("Sending user creation request with data:", JSON.stringify(userData, null, 2));

        // Disable submit button while processing
        const submitBtn = createUserForm.querySelector('button[type="submit"]');
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

        try {
            const result = await BrightspaceFetch('/d2l/api/lp/1.31/users/', "POST", userData);
            console.log("User created successfully:", result);
            
            // Extract UserId from result (supports different shapes)
            lastCreatedUserId = result && (result.UserId || result.Identifier || result.Id) ? Number(result.UserId || result.Identifier || result.Id) : null;
            
            // Show success message
            alert(`User ${firstName} ${lastName} created successfully!`);
            
            // Show result + next steps section
            if (resultSection && resultOutput) {
                const lines = [
                    `UserId: ${lastCreatedUserId !== null && !Number.isNaN(lastCreatedUserId) ? lastCreatedUserId : 'Unknown'}`,
                    `Name: ${firstName} ${lastName}`,
                    `Username: ${username}`,
                    `Email: ${email || 'N/A'}`,
                    `Role: ${userRole} (RoleId ${roleId})`,
                    `Status: ${status === "active" ? "Active" : "Inactive"}`
                ];

                resultOutput.textContent = lines.join('\n');
                resultSection.style.display = 'block';
            }

            // Configure "Edit in D2L" link if we have a UserId
            if (editUserLink) {
                if (lastCreatedUserId && !Number.isNaN(lastCreatedUserId)) {
                    const d2lEditUrl = `https://your-brightspace.example.edu/d2l/lp/manageUsers/admin/newedit_user.d2l?ou=1001&uid=${lastCreatedUserId}`;
                    editUserLink.href = d2lEditUrl;
                    editUserLink.style.display = 'inline-flex';
                } else {
                    editUserLink.style.display = 'none';
                }
            }

            // Reset form
            createUserForm.reset();
            
            // Optionally redirect or show success message in UI
            // You could also show a success banner here instead of alert
        } catch (error) {
            console.error("Error creating user:", error);
            alert(`Failed to create user. Error: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    });

    // Attach enroll-in-course handler if controls exist
    if (enrollCourseBtn && enrollCourseInput && enrollRoleInput && enrollCourseResult) {
        enrollCourseBtn.addEventListener('click', async () => {
            if (!lastCreatedUserId || Number.isNaN(lastCreatedUserId)) {
                alert('User ID not available. Please create a user first.');
                return;
            }

            const courseIdRaw = (enrollCourseInput.value || '').trim();
            const roleIdRaw = (enrollRoleInput.value || '').trim() || '101';

            if (!courseIdRaw) {
                alert('Please enter a Course OrgUnitId.');
                return;
            }

            const courseIdNum = Number(courseIdRaw);
            const roleIdNum = Number(roleIdRaw);

            if (Number.isNaN(courseIdNum) || Number.isNaN(roleIdNum)) {
                alert('Course OrgUnitId and RoleId must be numbers.');
                return;
            }

            enrollCourseBtn.disabled = true;
            const originalLabel = enrollCourseBtn.innerHTML;
            enrollCourseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enrolling...';

            if (enrollCourseResult) {
                enrollCourseResult.style.display = 'block';
                enrollCourseResult.textContent = 'Submitting enrollment request...';
            }

            const payload = {
                OrgUnitId: courseIdNum,
                UserId: lastCreatedUserId,
                RoleId: roleIdNum,
                IsCascading: false
            };

            try {
                const enrollResult = await BrightspaceFetch('/d2l/api/lp/1.46/enrollments/', 'POST', payload);
                console.log('Enrollment successful:', enrollResult);

                if (enrollCourseResult) {
                    enrollCourseResult.textContent = [
                        'Enrollment completed successfully.',
                        '',
                        `Course OrgUnitId: ${courseIdNum}`,
                        `UserId: ${lastCreatedUserId}`,
                        `RoleId: ${roleIdNum}`
                    ].join('\n');
                }
            } catch (error) {
                console.error('Error enrolling user in course:', error);
                if (enrollCourseResult) {
                    enrollCourseResult.textContent = `Failed to enroll user. Error: ${error.message || error}`;
                }
                alert(`Failed to enroll user. Error: ${error.message}`);
            } finally {
                enrollCourseBtn.disabled = false;
                enrollCourseBtn.innerHTML = originalLabel;
            }
        });
    }
}

// Try to initialize immediately (for modules that load after DOM)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCreateUserForm);
} else {
    // DOM is already loaded, but give it a tiny delay to ensure everything is ready
    setTimeout(initializeCreateUserForm, 0);
}

// Fallback: Try again after a short delay if form wasn't found
setTimeout(() => {
    if (!formInitialized) {
        console.log('Retrying form initialization...');
        initializeCreateUserForm();
    }
}, 100);
