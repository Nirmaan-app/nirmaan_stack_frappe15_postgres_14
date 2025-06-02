/// <reference types="cypress" />

const emailNP = Cypress.env('login_Email');
const passwordNP = Cypress.env('login_Password');

describe('Adding a New Project', () => {


    interface InterceptedRequest{
        request?: {
            body: any;
            method: string;
            url: string;
        };
        response?: {
            statusCode: number;
            body: any;
        };
    }


    beforeEach(() => {
        // Logging In -
        cy.intercept('POST', '**/api/method/login').as('loginRequest');

        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailNP);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordNP);
        cy.get('[data-cy="login-button"]').should('be.visible').click();    

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('creates a new project from the main layout', () => {

        cy.intercept('POST', '/api/projects').as('projectCreation');
        
        // 1. Card Container Validation
        cy.get('[data-cy="admin-dashboard-project-card"]')
        .should('exist')
        .and('be.visible')
        .and('have.class', 'shadow')
        .and('have.class', 'border')
        .then(($card) => {
            // 2. Verifying hover animation class
            expect($card).to.have.class('hover:animate-shadow-drop-center');

            // 3. Verifying link wrapping
            cy.wrap($card).find('a[href="/projects"]')
            .should('exist').should('have.attr', 'href', '/projects');

        });

        // 4. Projects counter Validation
        cy.get('[data-cy="admin-dashboard-project-card"]')
            .find('div.p-5.pt-0')
            .within(() => {
                cy.get('.text-2xl')
                    .should('be.visible')
                    .and(($el) => {
                        const textContent = $el.text();
                        expect(textContent.trim(), 'Element text should not be empty').not.to.be.empty;
                    })
                    .invoke('text')
                    .then((text) => {
                        cy.log(`Original text from element: "${text}"`);
                        const numericText = text.trim().replace(/[^0-9]/g, '');
                        cy.log(`Processed numericText: "${numericText}"`);
                        expect(numericText, 'Extracted numeric string should not be empty').not.to.be.empty;
                        expect(numericText, 'Project count should be numeric (consist of digits only)').to.match(/^\d+$/);
                        const count = parseInt(numericText, 10);
                        expect(count, 'Parsed count should be a number').not.to.be.NaN;
                        expect(count, 'Project count should be a positive number').to.be.a('number').and.be.gt(0);
                    });
        });

        // 5. Interaction Validation/Testing
        cy.get('[data-cy="admin-dashboard-project-card"] a')
            .should('have.attr', 'href', '/projects')
            .then(($link) => {
                const href = $link.attr('href');
                // cy.intercept('Get', href).as('projectsPage');
                cy.wrap($link).click();
                // cy.wait('@projectsPage').its('response.statusCode').should('eq', 200);
                cy.url().should('include', '/projects');
        });

        cy.get('button', {timeout: 2000})
        .contains(/Add( New Project)?/i)
        .should('be.visible')
        .and('not.be.disabled')
        .and('have.class', 'bg-primary');

        cy.contains('button', /Add( New Project)?/i)
        .find('svg.lucide-circle-plus')
        .should('exist')
        .and('be.visible');

        cy.contains('button', /Add( New Project)?/i)
        .click()
        .then(() => {
            cy.url().should('include', '/projects/new-project');
        });

        // Filling Project Name: ->
        cy.get('[data-cy="project-name"]')
        // cy.get('input[name="project_name"]')
        .should('exist').should('be.visible')

        .clear()
        .type('Test Project - Bangalore Office')
        .should('have.value', 'Test Project - Bangalore Office');

        // Selecting Customer (dropdown): ->
        cy.get('button[id$="-form-item"]').first().click();
        cy.contains('div[role="option"]', 'Beta Makers Lab').click();
        
        // Filling Project Value: ->
        cy.get('input[name="project_value"]')
        .type('500000')
        .should('have.value', '500000');

        // Selecting Project Type (dropdown): ->
        cy.get('button[id$="-form-item"]').eq(1).click();
        cy.contains('div[role="option"]', 'Office').click();

        // Select GST (dropdown - already selected by default)
        // Optionally verifying the default: ->
        cy.contains('button[id$="-form-item"]', 'Bengaluru').should('exist');

        // Selecting Sub-Divisions (dropdown): ->
        cy.get('button[id$="-form-item"]').eq(3).click();
        cy.contains('div[role="option"]', '2').click();

        cy.contains('button', 'Next')
        .should('be.visible')
        .should('be.enabled')
        .click();



        // Filling Address Line 1
        cy.get('input[name="address_line_1"]')
        .type('123 Tech Park, 5th Floor')
        .should('have.value', '123 Tech Park, 5th Floor');

        // Filling Address Line 2
        cy.get('input[name="address_line_2"]')
        .type('MG Road, Koramangala')
        .should('have.value', 'MG Road, Koramangala');

        // Verifying disabled City field (auto-filled based on Pin Code)
        cy.get('input[name="project_city"]')
        .should('be.disabled');
        // .and('have.value', 'Bengaluru');

        // Verifying disabled State field (auto-filled based on Pin Code)
        cy.get('input[name="project_state"]')
        .should('be.disabled');
        // .and('have.value', 'Karnataka');

        // Fill PIN Code
        cy.get('input[name="pin"]')
        .type('560034')
        .should('have.value', '560034');

        // Fill Phone (optional)
        cy.get('input[name="phone"]')
        .type('9876543210')
        .should('have.value', '9876543210');
        
        // Fill Email (optional)
        cy.get('input[name="email"]')
        .type('project@example.com')
        .should('have.value', 'project@example.com');

        // Click Next button
        cy.contains('button', 'Next')
        .should('be.enabled')
        .click();

        // Step No. 3 ------------>

        cy.get('.ant-steps-item-active .ant-steps-item-title')
        .should('contain', 'Project Timeline');

        const today = new Date();
        const currentDate = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getFullYear())}`;
        cy.log(currentDate);

        // Selecting Start Date
        cy.contains('button', currentDate).click();
        // Select 7 days from today
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 3/** + 7 */ );
        cy.log('futureDate'); 
        const formattedStartDate = `${String(futureDate.getDate()).padStart(2, '0')}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${futureDate.getFullYear()}`;
        
        // Handling month navigation if needed
        if (futureDate.getMonth() !== futureDate.getMonth()) {
            cy.get('button[name="next-month"]', {timeout: 20000}).click();
        }

        cy.get('button[name="day"]')
        .contains(futureDate.getDate())
        .click();

        // Selecting End Date (30 days after start date)
        cy.contains('button', /Pick a date/).click();
        const endDate = new Date(futureDate);
        endDate.setDate(endDate.getDate() + 30);
        const formattedEndDate = `${String(endDate.getDate()).padStart(2, '0')}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${endDate.getFullYear()}`;
        
        // Handling month navigation if needed
        if (endDate.getMonth() !== futureDate.getMonth()) {
            cy.get('button[name="next-month"]', {timeout: 2000}).click();
        }
        
        cy.get('button[name="day"]',{timeout: 2000})
        .contains(endDate.getDate())
        .click();

        // Verify duration calculation with retry logic
        const expectedDuration = 30;
        const verifyDuration = () => {
            cy.contains('Duration:')
                .next()
                .then(($el) => {
                    const actualDuration = parseInt($el.text());
                    if(actualDuration !== expectedDuration){
                        cy.wait(1000);
                        // Retry 
                        verifyDuration();
                    } else {
                        expect(actualDuration).to.eq(expectedDuration);
                        expect($el.text()).to.contain('(Days)');
                    }
                });
        };
        // verifyDuration();

        // Verify duration calculation
        cy.wait(16000);
        const expectedDuration2 = 30;
        cy.contains('Duration:')
        .next()
        .should('contain', expectedDuration2)
        .and('contain', '(Days)');

        // Previous button ( Not Clicking )
        cy.contains('button', 'Previous')
        .should('be.enabled')
        // .click();

        // Clicking Next button
        cy.contains('button', 'Next')
        .should('be.enabled')
        .click();

        // Verifying navigation to next step
        cy.get('.ant-steps-item-active .ant-steps-item-title')
        .should('contain', 'Project Assignees');

        // const futureDate = new Date();
        // futureDate.setDate(futureDate.getDate() + 7);
        // const formattedDate = futureDate.toLocaleDateString('en-GB').replace(/\//g, '-');
        // cy.log(formattedDate);
        // cy.get('button[name="day"]').next().click();

        // cy.contains('button', /Pick a date/).click();

        // const endDate = new Date(futureDate);
        // endDate.setDate(endDate.getDate() + 30);
        // const formattedEndDate = endDate.toLocaleDateString('en-GB').replace(/\//g, '-');
        // cy.contains('td[role="gridcell"]', endDate.getDate()).click();

        // Step No. 4 ------------>

        // Verifying current step is active
        cy.get('.ant-steps-item-active .ant-steps-item-title')
        .should('contain', 'Project Assignees');

        // 1. Project Lead Selection
        cy.get('button[id$="-form-item"]').first().click();
        cy.contains('[role="option"]', 'Bhanu Agrawal')
        .scrollIntoView()
        .click()

        cy.get('button[id$="-form-item"]').first()
        .should('contain', 'Bhanu Agrawal');

        // 2. Project Manager Selection (with random selection)
        cy.get('button[id$="-form-item"]').eq(1).click();
        cy.get('[role="option"]').then($options => {
            const randomManager = $options[Math.floor(Math.random() * $options.length)];
            cy.wrap(randomManager).click();
        });

        // 3. Procurement Lead Selection
        cy.get('button[id$="-form-item"]').eq(2).click();
        cy.contains('[role="option"]', 'Dhivya Rasika')
        .click();

        cy.get('button[id$="-form-item"]').eq(2)
        .should('contain', 'Dhivya Rasika');

        // 4. Accountant Selection (optional)
        cy.get('button[id$="-form-item"]').eq(4).click();
        cy.contains('[role="option"]', 'Vidyashree S')
        .click();

        // Verify all selections are visible and present 
        cy.get('button[id$="-form-item"]').should(($button) => {
            expect($button.eq(0)).to.contain('Bhanu Agrawal');
            expect($button.eq(2)).to.contain('Dhivya Rasika');
            expect($button.eq(4)).to.contain('Vidyashree S');
        });

        cy.contains('button', 'Previous')
        .should('exist')
        .should('be.enabled')
        // .click();

        cy.contains('button', 'Next')
        .should('exist')
        .should('be.visible')
        .click();

        cy.get('.ant-steps-item-active .ant-steps-item-title')
        .should('contain', 'Package Selection');

        // Step No. 5 ------------>

        // cy.get('button[role="checkbox"]').then(($checkboxes) => {
        //     // Find the one associated with "Electrical Work"
        //     const electricWorkCheckbox = $checkboxes.filter((index, el) => {
        //       return Cypress.$(el).next('label').text().trim() === 'Electrical Work';
        //     });
            
        //     // Click it
        //     cy.wrap(electricWorkCheckbox)
        //       .click()
        //       .should('have.attr', 'data-state', 'checked');
        //   });

        // cy.contains('div', 'Electrical Work').within(() => {
        //     cy.get('button[role="checkbox"]')
        //       .click()
        //       .should('have.attr', 'data-state', 'checked');
        //   });

        cy.contains('div', 'Electrical Work').should('be.visible')
        .within(() => {

            // 1. Verifying checkbox exists and is unchecked initially
            cy.get('button[role="checkbox"]')
                .should('exist')
                .and('have.attr', 'data-state', 'unchecked')
                .and('have.attr', 'aria-checked', 'false');

            // 2. Clicking the checkbox
            cy.get('button[role="checkbox"]').click();

            // 3. Verifying checked state after click
            cy.get('button[role="checkbox"]')
                .should('have.attr', 'data-state', 'checked')
                .and('have.attr', 'aria-checked', 'true');

            cy.get('label')
                .should('contain', 'Electrical Work')
                // .and('have.css', 'cursor', 'pointer');
        });

        cy.contains('button', 'Previous')
        .should('exist')
        .should('be.enabled')
        // .click();

        cy.contains('button', 'Next')
        .should('exist')
        .should('be.visible')
        .click();

        cy.get('.ant-steps-item-active .ant-steps-item-title')
        .should('contain', 'Review Details');

        // cy.pause();

        // Step No. 6 ------------>

        // Verifying Project Details Section
        cy.contains('h2', 'Project Details')
        .should('be.visible');

        cy.contains('p', 'Project Name')
        .next('p').should('have.text', 'Test Project - Bangalore Office')
        .and('have.class', 'italic');
        
        cy.contains('p', 'Project Type')
        .next('p').should('have.text', 'Office')
        .and('have.class', 'italic');

        cy.contains('p', 'Customer')
        .next('p')
        .should('have.text', 'Beta Makers Lab')
        .and('have.class', 'italic');

        cy.contains('p', 'Project Value')
        .next('p')
        .should('have.text', '500000')
        .and('have.class', 'italic');

        // Verifying Project Address Details
        cy.contains('h2', 'Project Address Details')
        .should('be.visible');

        cy.contains('p', 'Address Line 1')
        .next('p')
        .should('have.text','123 Tech Park, 5th Floor')
        .and('have.class', 'italic');

        cy.contains('p', 'Address Line 2')
        .next('p')
        .should('have.text', 'MG Road, Koramangala')
        .and('have.class', 'italic');

        cy.contains('p', 'City')
        .next('p')
        .should('have.text', 'BENGALURU')
        .and('have.class', 'italic');

        cy.contains('p', 'State')
        .next('p')
        .should('have.text', 'Karnataka')
        .and('have.class', 'italic');

        cy.contains('p', 'Pincode')
        .next('p')
        .should('have.text', '560034')
        .and('have.class', 'italic');

        cy.contains('p', 'Phone')
        .next('p')
        .should('have.text', '9876543210')
        .and('have.class', 'italic');

        cy.contains('p', 'Email')
        .next('p')
        .should('have.text', 'project@example.com')
        .and('have.class', 'italic');

        // Verifying Project Timeline

        cy.contains('h2', 'Project Timeline')
        .should('be.visible');

        cy.contains('p', 'Start Date')
        .next('p')
        .invoke('text')
        .then((uiText) => {
            const uiDateParts = uiText.trim().split('/');
            const uiDateFormatted = `${uiDateParts[1].padStart(2, '0')}-${uiDateParts[0].padStart(2, '0')}-${uiDateParts[2]}`;
            expect(uiDateFormatted).to.equal(formattedStartDate);
        });

        cy.contains('p', 'End Date')
        .next('p')
        .invoke('text')
        .then((uiText) => {
            const uiDateParts = uiText.trim().split('/');
            const uiDateFormatted = `${uiDateParts[1].padStart(2, '0')}-${uiDateParts[0].padStart(2, '0')}-${uiDateParts[2]}`
            expect(uiDateFormatted).to.equal(formattedEndDate);
        })

        cy.contains('p', 'Duration').next('p').should('have.text', `${expectedDuration} days`);

        // Verifying Project Assignees
        cy.contains('h2', 'Project Assignees').should('be.visible');
        cy.contains('p', 'Project Lead').next('p').should('have.text', 'Bhanu Agrawal');
        cy.contains('p', 'Procurement Lead').next('p').should('have.text', 'Dhivya Rasika');
        // cy.contains('p', 'Project Manager').next('p').should('have.text', 'Sukesh Kumar');
        cy.contains('p', 'Accountant').next('p').should('have.text', 'Vidyashree S');
        cy.contains('p', 'Design Lead').next('p').should('have.text', 'N/A');

        // Verifying Selected Packages (Electrical Work)
        cy.contains('h2', 'Selected Packages').should('be.visible');
        cy.contains('p', 'Electrical Work').should('be.visible');

        // Verifying all Electrical Work sub-items
        // const electriclItems = [
        //     'Raceway', 'Cable Tray & Junction Box', 'Conduits', 'Earthing Material',
        //     'Industrial Sockets', 'UPS & Inverter', 'Enclosure', 'LT Panels',
        //     'Raceway & Cable Tray', 'Lighting', 'DB & Switch Gear', 'Switch & Sockets',
        //     'Wires & Cables', 'Conduits & Accessories', 'Electrical Miscellaneous',
        //     'Electrical Accessories', 'UPS Batteries', 'Temp Lighting & Power'
        // ];

        // electriclItems.forEach(item => {
        //     cy.contains('li', `${item}:`).should('contain', 'N/A');
        // });

        // cy.get('body')
        //     .then(($body) => {
        //         const successDialogExists = $body.find(':contains("Project Created Successfully!")').length > 0;
        //         const nextButtonDisabled = $body.find('button:contains("Next: Fill Estimates")').prop('disabled');

        //         if( successDialogExists || !nextButtonDisabled){
        //             cy.log('WARNING: Project was created without clicking Submit button!');
        //             cy.log('Evidence:')
        //             if (successDialogExists) cy.log('- Success dialog appeared unexpectedly');
        //             if (!nextButtonDisabled) cy.log('- "Next" button was enabled without submission');

        //             cy.get('@projectCreation.all')
        //             .then((interceptions: InterceptedRequest[]) => {
        //                     if( interceptions.length > 0){
        //                         const firstCall = interceptions[0];
        //                         cy.log(` -API is called ${interceptions.length} times without user action.`);

        //                         if(firstCall.request){
        //                             cy.log(`- First call method: ${firstCall.request.method}`);
        //                             cy.log(`- First call URL: ${firstCall.request.url}`);

        //                             // Stringify with error handling
        //                             try {
        //                                 const payload = JSON.stringify(firstCall.request.body, null, 2);
        //                                 cy.log('- First call payload:');
        //                                 cy.log(payload);
        //                             } catch (error) {
        //                                 cy.log('- Could not stringify payload:', error)
        //                             }
        //                         } else {
        //                             cy.log('- No request object captured');
        //                         }
        //                         // cy.log(` -Firct Call Payload: ${JSON.stringify(interceptions[0].request.body)}`);
        //                     }
        //                 });

        //             throw new Error('Project submitted automatically - this should require manual Submission.');
        //         }
        //         else{
        //             cy.log('VALIDATION PASSED: Project was not created without clicking Submit');
        //             cy.log('Evidence:');
        //             cy.log('- Success dialog does not exist');
        //             cy.log('- "Next" button remains disabled');

        //             // Verifying no API calls were made
        //             cy.get('@projectCreation.all').should('have.length', 0);
        //         }
        //     });


        cy.get('body').then(($body) => {
            const successDialogExists = $body.find(':contains("Project Created Successfully!")').length > 0;
            const nextButtonDisabled = $body.find('button:contains("Next: Fill Estimates")').prop('disabled');
        
            if (successDialogExists || !nextButtonDisabled) {
              cy.log('WARNING: Project was created without clicking Submit button!');
              cy.log('Evidence:');
              if (successDialogExists) cy.log('- Success dialog appeared unexpectedly');
              if (!nextButtonDisabled) cy.log('- "Next" button was enabled without submission');
        
              // CORRECTED: Use separate Cypress chain for interceptions
              cy.get('@projectCreation.all').then((interceptions) => {
                const typedInterceptions = interceptions as unknown as InterceptedRequest[];
                
                if (typedInterceptions.length > 0) {
                  cy.log(`- API was called ${typedInterceptions.length} times without user action`);
                  const firstCall = typedInterceptions[0];
                  
                  if (firstCall.request) {
                    cy.log(`- First call method: ${firstCall.request.method}`);
                    cy.log(`- First call URL: ${firstCall.request.url}`);
                    
                    try {
                      const payload = JSON.stringify(firstCall.request.body, null, 2);
                      cy.log('- First call payload:');
                      cy.log(payload);
                    } catch (error) {
                      cy.log('- Could not stringify payload:', error);
                    }
                  }
                }
              });
        
              throw new Error('Project submitted automatically - this should require manual submission');

            } else {
              cy.log('VALIDATION PASSED: Project was not created without clicking Submit');
              cy.log('Evidence:');
              cy.log('- Success dialog does not exist');
              cy.log('- "Next" button remains disabled');
              cy.get('@projectCreation.all').should('have.length', 0);
            }
          });


        cy.contains('button', 'Submit')
        .should('be.visible')
        .click();

        cy.wait('@projectCreation')
        .its('response.statusCode')
        .should('eq', 200);

        cy.log('Normal submission completed successfully');
                
    });
});