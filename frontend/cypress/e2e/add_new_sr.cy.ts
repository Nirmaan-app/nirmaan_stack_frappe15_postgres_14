/// <reference types="cypress" />
const emailSr = Cypress.env('login_Email');
const passwordSr = Cypress.env('login_Password');

describe('Adding a New Service Request', () => {
    
    beforeEach( () => {

        // Logging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailSr);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordSr);
        cy.get('[data-cy="login-button"]').should('be.visible').click();    

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

        const serviceDescriptions = {
            "Access Control ServicesComments": [
            "Installation of biometric access system for main office entrance.",
            "RFID card access system for all employee doors.",
            "Facial recognition system upgrade for building security.",
            "Emergency door release mechanism installation."
        ],
        "Carpentry ServicesComments": [
            "Custom wooden shelving for executive offices.",
            "Repair of damaged conference room doors.",
            "Installation of hardwood flooring in reception area.",
            "Built-in cabinet construction for storage rooms."
        ],
        "CCTV ServicesComments": [
            "16-channel CCTV system installation for warehouse.",
            "High-resolution cameras for parking lot surveillance.",
            "Night vision cameras for perimeter security.",
            "PTZ camera installation at main entrance."
        ],
        "Data & Networking ServicesComments": [
            "Cat6 cabling for new office wing.",
            "Network switch upgrade to support 1Gbps throughput.",
            "Wi-Fi access point installation in common areas.",
            "Server room cable management reorganization."
        ],
        "Electrical ServicesComments": [
            "LED lighting retrofit for entire 3rd floor.",
            "Emergency power backup system maintenance.",
            "Electrical panel upgrade to support new equipment.",
            "Outlet installation for new workstations."
        ],
        "FA ServicesComments": [
            "Annual fire alarm system inspection and testing.",
            "Smoke detector installation in storage areas.",
            "Emergency voice evacuation system upgrade.",
            "Fire alarm control panel replacement."
        ],
        "Fire Fighting ServicesComments": [
            "Fire extinguisher refilling and maintenance.",
            "Sprinkler system installation in server room.",
            "Fire hydrant flow testing and certification.",
            "Emergency exit signage illumination upgrade."
        ],
        "HVAC ServicesComments": [
            "AC duct cleaning for entire building.",
            "Chiller unit preventive maintenance.",
            "Thermostat upgrade to smart controls.",
            "Ventilation system inspection and repair."
        ],
        "Miscellaneous ServicesComments": [
            "Office furniture assembly and installation.",
            "Window blind installation for new meeting rooms.",
            "Pest control treatment for cafeteria area.",
            "Moving and relocation services for department shift."
        ],
        "Painting ServicesComments": [
            "Interior repainting of all common areas.",
            "Exterior weatherproof coating application.",
            "Specialty epoxy flooring for laboratory.",
            "Brand color accent wall in reception."
        ],
        "PA ServicesComments": [
            "Background music system installation in lobby.",
            "Emergency announcement system testing.",
            "Conference room speaker system upgrade.",
            "Outdoor paging horn installation."
        ],
        "POP ServicesComments": [
            "False ceiling installation in executive offices.",
            "Decorative wall paneling for meeting rooms.",
            "Ceiling cornice work in main lobby.",
            "POP partition wall construction."
        ]
    };

    it('Navigates to Service Requests page and adds a New Service Request', () => {

        cy.get('[data-cy="service-requests-button"]').should('be.visible').click();
        cy.url().should('include', 'service-requests');

        cy.contains('Add New SR').should('be.visible').click();
        cy.get('.css-art2ul-ValueContainer2').click();
        cy.get('.css-1nmdiq5-menu')
        .find('[role="option"]')
            .then( $projects => {
                const randomIndex = Math.floor(Math.random() * $projects.length);
                const selectedProjectText = $projects[randomIndex].textContent;
                cy.log(`Randomly Selected Projects for Service Request: ${selectedProjectText}`);
                cy.wrap($projects[randomIndex]).click();
            });

        cy.get('button')
            .contains('Add New SR')
            .find('svg.lucide-circle-plus')
            .should('exist')
            .and('be.visible')
            .and('not.have.attr', 'disabled');

        cy.get('button')
            .contains('Add New SR')
            .click();

        cy.get('.rounded-xl.bg-card').should('have.length.gt', 0)
            .then(($cards) => {
                const randomIndex = Math.floor(Math.random() * $cards.length);
                const selectedCardText = $cards[randomIndex].textContent;
                cy.log(`RandomlySelected Service Package: ${selectedCardText}`);
                cy.wrap($cards[randomIndex]).click();
            });

        cy.get('#description')
            .should('exist')
            .and('be.visible')
            .and('have.class', 'min-h-[80px]')
            .and('have.class', 'rounded-md');

    // Get the selected category name from the header
    cy.get('main h3.font-bold').invoke('text')
        .then((category) => {
            const trimmedCategory = category.trim();
            cy.log(trimmedCategory);
            const descriptions = serviceDescriptions[trimmedCategory] || ["Default service description"];
            
            // Selecting random data
            const randomDescription = descriptions[Math.floor(Math.random() * descriptions.length)];

            cy.get('#description')
            .should('be.visible')
            .clear()
            .type(randomDescription)
            .should('have.value', randomDescription);
            cy.log(randomDescription)
        });

    const units = ["Each", "Set", "Hour", "Day", "Square Meter", "Unit"];
    const comments = [
        "Urgent priority - needed by Friday",
        "Standard service request",
        "Follow up with vendor confirmation"
    ];

    const randomUnit = units[Math.floor(Math.random() * units.length)];
    const randomQuantity = Math.floor(Math.random() * 10) + 1;
    const randomComment = comments[Math.floor(Math.random() * comments.length)];

    cy.get('#uom')
        .should('be.visible')
        .clear()
        .type(randomUnit)
        .should('have.value', randomUnit);

    cy.get('#quantity')
        .should('be.visible')
        .clear()
        .type(randomQuantity.toString())
        .should('have.value', randomQuantity.toString());

    cy.contains('button', 'Add')
        .should('be.visible')
        .and('not.have.attr', 'disabled')
        
    cy.contains('button', 'Add').click();

    cy.get('textarea[placeholder="Write comments here..."]')
        .clear()
        .type(randomComment)
        .should('have.value', randomComment);

    cy.contains('button', 'Submit')
        .should('be.visible')
        .and('not.have.attr', 'disabled')

    cy.contains('button', 'Submit').click();


    cy.contains('button', 'Confirm')
        .should('be.visible')
        .click();

    cy.log(`Added a New Service Request Successfully......`);

    });

    it('Navigates to Service Requests page to add a New Service Request and Send it for Approval', () => {

        cy.get('[data-cy="service-requests-button"]').should('be.visible').click();
        cy.url().should('include', 'service-requests');

        cy.contains('Add New SR').should('be.visible').click();
        cy.get('.css-art2ul-ValueContainer2').click();
        cy.get('.css-1nmdiq5-menu')
        .find('[role="option"]')
            .then( $projects => {
                const randomIndex = Math.floor(Math.random() * $projects.length);
                const selectedProjectText = $projects[randomIndex].textContent;
                cy.log(`Randomly Selected Projects for Service Request: ${selectedProjectText}`);
                cy.wrap($projects[randomIndex]).click();
            });

        cy.get('button')
            .contains('Add New SR')
            .find('svg.lucide-circle-plus')
            .should('exist')
            .and('be.visible')
            .and('not.have.attr', 'disabled');

        cy.get('button')
            .contains('Add New SR')
            .click();

        cy.get('.rounded-xl.bg-card').should('have.length.gt', 0)
            .then(($cards) => {
                const randomIndex = Math.floor(Math.random() * $cards.length);
                const selectedCardText = $cards[randomIndex].textContent;
                cy.log(`RandomlySelected Service Package: ${selectedCardText}`);
                cy.wrap($cards[randomIndex]).click();
            });

        cy.get('#description')
            .should('exist')
            .and('be.visible')
            .and('have.class', 'min-h-[80px]')
            .and('have.class', 'rounded-md');

    // Get the selected category name from the header
    cy.get('main h3.font-bold').invoke('text')
        .then((category) => {
            const trimmedCategory = category.trim();
            cy.log(trimmedCategory);
            const descriptions = serviceDescriptions[trimmedCategory] || ["Default service description"];
            
            // Selecting random data
            const randomDescription = descriptions[Math.floor(Math.random() * descriptions.length)];

            cy.get('#description')
            .should('be.visible')
            .clear()
            .type(randomDescription)
            .should('have.value', randomDescription);
            cy.log(randomDescription)
        });


    const units = ["Each", "Set", "Hour", "Day", "Square Meter", "Unit"];
    const comments = [
        "Urgent priority - needed by Friday",
        "Standard service request",
        "Follow up with vendor confirmation"
    ];

    const randomUnit = units[Math.floor(Math.random() * units.length)];
    const randomQuantity = Math.floor(Math.random() * 10) + 1;
    const randomComment = comments[Math.floor(Math.random() * comments.length)];

    cy.get('#uom')
        .should('be.visible')
        .clear()
        .type(randomUnit)
        .should('have.value', randomUnit);

    cy.get('#quantity')
        .should('be.visible')
        .clear()
        .type(randomQuantity.toString())
        .should('have.value', randomQuantity.toString());

    cy.contains('button', 'Add')
        .should('be.visible')
        .and('not.have.attr', 'disabled')
        
    cy.contains('button', 'Add').click();

    cy.get('textarea[placeholder="Write comments here..."]')
        .clear()
        .type(randomComment)
        .should('have.value', randomComment);

    cy.contains('button', 'Submit')
        .should('be.visible')
        .and('not.have.attr', 'disabled')

    cy.contains('button', 'Submit').click();

    cy.contains('button', 'Confirm')
        .should('be.visible')
        .click();

    cy.get('.css-art2ul-ValueContainer2')
        .should('exist')
        .should('be.visible')
        .click();

    cy.get('.css-1nmdiq5-menu').should('exist').should('be.visible')
    .find('[role="option"]')
    .then($vendors => {
        const randomIndex = Math.floor(Math.random() * $vendors.length);
        const randomVendor = $vendors[randomIndex].textContent;
        cy.log(`Randomly selected Vendor: ${randomVendor}`);
        cy.wrap($vendors[randomIndex]).click();
    });

    cy.get('.border-b > :nth-child(5) > .flex').last()
        .scrollIntoView()
        .should('be.visible')
        .clear()
        .type(String(Math.floor(Math.random() * 9) + 33));

    cy.contains('button', 'Next')
        .should('have.class', 'bg-primary')
        .and('not.be.disabled')
        .click();

    cy.contains('button', 'Send for Approval')
        .should('have.class', 'bg-primary')
        .and('not.be.disabled')
        .click();

    cy.get('textarea[placeholder="Optional"]', {timeout: 1000})
        .should('have.attr', 'placeholder', 'Optional')
        .should('have.class', 'w-full')
        .clear()
        .type('This is a Test Comment for Confirmation of Sending a Service Request for Approval......');

    cy.contains('button', /^Cancel$/i)
        .should('have.class', 'shadow-sm')
        .and('have.attr', 'type', 'button')
        .and('be.visible')
        // .click();
    cy.get('button svg.lucide-check-check')
        .parent('button')
        .should('contain', 'Confirm')
        .should('have.class', 'text-primary-foreground')
        .and('be.visible')
        .click();

    cy.log(`Added a New Service Request and Sended it for Approval Successfully......`);

    });
});