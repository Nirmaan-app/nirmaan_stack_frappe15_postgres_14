// <reference types="Cypress" />

const emailAPr = Cypress.env('login_Email');
const passwordAPr = Cypress.env('login_Password');

describe('Approving a PR from Approve PR Navigation Tab', () => {

    beforeEach( () => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailAPr);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordAPr);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('Navigates to Procurement requests page And check for it', () => {

        cy.get('[data-cy="procurement-requests-button"]').should('be.visible').click();
        cy.get('[data-cy="procurement-requests-search-bar"]').should('be.visible');
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created On').should('be.visible');
        });
      });

      it('Navigates to next Page in PR table', () => {

        cy.get('[data-cy="procurement-requests-button"]').click();
        cy.get('[data-cy="procurement-requests-data-table"]').should('be.visible');

        cy.contains('div', /Page \d+ of \d+/)
            .then(($pageInfo) => {
                const pageText = $pageInfo.text().trim();
                const currentPage = parseInt(pageText.match(/Page (\d+) of/)[1]);
                const totalPages = parseInt(pageText.match(/of (\d+)/)[1]);

                if (totalPages > 1) {

                    // Clicking next page button
                    cy.get(':nth-child(3) > .h-4')
                    .scrollIntoView()
                    .should('be.visible')
                    .click();

                    // Verifying page changed
                    cy.contains('div', `Page ${currentPage + 1} of ${totalPages}`).should('be.visible');

                    // Verifying table still has data
                    cy.get('[data-cy="procurement-requests-data-table"] tbody tr').should('have.length.at.least', 1);
                } else {
                    cy.log('Only one page available, skipping pagination test');
                }
            });
      });

    //   it('Clicks on a PR and navigates to PR Details page', () => {

    //     cy.get('[data-cy="procurement-requests-button"]').click();
    //     cy.get('[data-cy="procurement-requests-data-table"]').should('be.visible');

    //     // Get the first PR link in the table
    //     cy.get('[data-cy="procurement-requests-data-table"] tbody tr', {timeout: 10000})
    //         .should('have.length.gt', 0)
    //         .first()
    //         .within(() => {
    //             // Verifying PR link exists and get its text and href
    //             cy.get('a[href^="/procurement-requests/PR-"]', {timeout: 10000})
    //                 .should('exist')
    //                 .and('be.visible')
    //                 .then(($link) => {
    //                     const prNumber = $link.text().trim();
    //                     const href = $link.attr('href');

    //                     // Debugging logs
    //                     cy.log(`Found PR link with href: ${href}`);
    //                     cy.log(`PR Number: ${prNumber}`);

    //                     // Decode the URI component for comparison
    //                     // const decodedHref = decodeURIComponent(href);

    //                     // Click on the PR link
    //                     cy.wrap($link).click();

    //                     // Verifying navigation to PR details page
    //                     // cy.url().should('include', `http://localhost:8080${decodedHref}`);
    
    //                     // Verify navigation - decode both URLs for comparison
    //                     cy.url({ timeout: 15000 }).then(currentUrl => {
    //                         const decodedCurrentUrl = decodeURIComponent(currentUrl);
    //                         const expectedUrl = `http://localhost:8080${decodeURIComponent(href)}`;
    //                         cy.log(`Current URL: ${decodedCurrentUrl}`);
    //                         cy.log(`Expected URL: ${expectedUrl}`);
    //                         expect(decodedCurrentUrl).to.include(expectedUrl);
    //                     });
                     
    //                     cy.contains(`PR-${prNumber}`, {timeout: 10000}).should('be.visible');
    //                     cy.contains('Approve/Reject/Delete PR', {timeout: 10000}).should('be.visible');

    //                 });
    //         });

    //   });


      it('Clicks on a PR and navigates to details page', () => {
        // Navigate to procurement requests page
        cy.get('[data-cy="procurement-requests-button"]').click();
        cy.get('[data-cy="procurement-requests-data-table"]').should('be.visible');
    
        // Base Url
        const baseUrl = Cypress.config('baseUrl');
        
        // Store PR details before navigation
        let prNumber, expectedUrl;
    
        // Get the first PR link details
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
            .first()
            .within(() => {
                cy.get('a[href^="/procurement-requests/PR-"]')
                    .should('be.visible')
                    .then(($link) => {
                         prNumber = $link.text().trim();
                        const href = $link.attr('href');
                        expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;
                        
                        // Click on the PR link (this will cause navigation)
                        cy.wrap($link).click();
                    });
            });
    
        // After navigation, verify the new page
        cy.url().then(currentUrl => {
            const decodedCurrentUrl = decodeURIComponent(currentUrl);
            expect(decodedCurrentUrl).to.include(expectedUrl);
        });
    
        // Verify page content on the new page
        // cy.log(prNumber)
        // cy.contains(`PR-${prNumber}`, { timeout: 10000 }).should('be.visible');
        cy.contains('Approve/Reject/Delete PR', { timeout: 10000 }).should('be.visible');
    });

    // it('Clicks on a PR and navigates to details page', () => {
    //     // Navigate to procurement requests page
    //     cy.get('[data-cy="procurement-requests-button"]').click();
    //     cy.get('[data-cy="procurement-requests-data-table"]').should('be.visible');
    
    //     // Get the first PR link and extract details
    //     cy.get('[data-cy="procurement-requests-data-table"] tbody tr:first-child a[href^="/procurement-requests/PR-"]')
    //         .should('be.visible')
    //         .then(($link) => {
    //             const prNumber = $link.text().trim();
    //             const href = $link.attr('href');
    //             const expectedUrl = `http://localhost:8080${decodeURIComponent(href)}`;
                
    //             // Click the link and verify navigation
    //             cy.wrap($link).click();
                
    //             // Verify URL after navigation
    //             cy.url().then(currentUrl => {
    //                 const decodedCurrentUrl = decodeURIComponent(currentUrl);
    //                 expect(decodedCurrentUrl).to.include(expectedUrl);
    //             });
    
    //             // Verify page content using aliases to maintain context
    //             cy.wrap(prNumber).as('prNumber');
    //         });
    
    //     // Get the stored PR number and verify page content
    //     cy.get('@prNumber').then((prNumber) => {
    //         cy.contains(`PR-${prNumber}`, { timeout: 15000 }).should('be.visible');
    //         cy.contains('Approve/Reject/Delete PR', { timeout: 15000 }).should('be.visible');
    //     });
    // });
   
    
    it('Tests all PR Actions Buttons', () => {

        cy.get('[data-cy="procurement-requests-button"]').click();
        cy.get('[data-cy="procurement-requests-data-table"] tbody tr:first-child a[href^="/procurement-requests/PR-"]')
        .should('be.visible')
        .click();

        // Test Delete PR Button
        // cy.contains('button', 'Delete PR')
        cy.get('[data-cy="delete-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Delete')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Reject PR Button
        // cy.contains('button', 'Reject PR')
        cy.get('[data-cy="reject-pr-button"]')
            .should('be.visible')
            .and('have.class', 'border-primary')
            .click();
            cy.contains('button', 'Confirm Rejection')
                .should('exist')
                .and('be.visible')
                // .click()
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                .click();

        // Test Approve PR button
        // cy.contains('button', 'Approve PR')
        cy.get('[data-cy="approve-pr-button"]')
            .should('be.visible')
            .and('not.have.class', 'border-primary')
            .and('have.class', 'bg-primary')
            .click();
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                // .click();
            cy.contains('button', 'Confirm Approval')
                .should('exist')
                .and('be.visible')
                .click()
            cy.contains('PR Approved')
                .should('exist')
                .and('be.visible')
        });


        // it('Clicks on a PR, navigates to details page and validates "Add Missing Products" button functionality', ()=> {

        //     cy.get('[data-cy="procurement-requests-button"]').click();
        //     cy.get('[data-cy="procurement-requests-data-table"] tbody tr:first-child a[href^="/procurement-requests/PR-"]')
        //     .should('be.visible')
        //     .click();

        //     // 1. Basic rendering validation
        //     cy.contains('button', 'Add Missing Products' /** /^Add Missing Products$/ **/)
        //         .should('be.visible')
        //         .and('have.class', 'bg-blue-600')
        //         .and('have.css', 'color', 'rgb(255, 255, 255)' )
        //         .and('not.be.disabled');

        //     // 2. Icon validation
        //     cy.contains('button', 'Add Missing Products')
        //         .find('svg.lucide-circle-plus')
        //         .should('exist')
        //         .and('be.visible');

        //     // cy.contains('button', 'Add Missing Products').click();

        //     // 3. Hover state validation
        //     // cy.contains('button', 'Add Missing Products')
        //     //     .realHover()
        //     //     .should('have.css', 'background-color', 'rgb(59, 130, 246)');

        //     // 4. Click functionality with API mock
        // // ------------------------------------------------------ //

        //     // cy.intercept('GET', '/api/resource/Projects', {
        //     //     statusCode: 200,
        //     //     body: { success: true}
        //     // }).as('addProducts');

        //     // cy.contains('button', 'Add Missing Products').click();

        //     // // 5. Post-click validation
        //     // cy.get('@addProducts').its('request.body')
        //     //     .should('deep.equal', { action: 'Projects' });

        //     //  // 6. Loading state validation (if applicable)
        //     //  cy.contains('button', 'Add Missing Products')
        //     //     .should('contain', 'Adding...')
        //     //     .and('be.disabled');
        
        // // ------------------------------------------------------ //

        //     // // 7. Success state validation
        //     // cy.contains('.notification', 'Products added successfully')
        //     // .should('be.visible');

        // // 1. Opening the modal by clicking the button
        // // cy.contains('button', 'Add Missing Products').click();

        //  // 2. Verifying modal appears with correct structure
        // //  cy.get('[role="alertdialog"]')
        // //     .should('be.visible')
        // //     .within(() => {
        // //         // 3. Validate header section
        // //         cy.contains('h2', 'Add Missing Product')
        // //             .should('be.visible');
        // //         cy.get('button').contains('X')
        // //             .should('be.visible');
                
        // //         // 4. Testing product selection dropdown
        // //         cy.contains('label', 'Select Product')
        // //             .should('be.visible');

        // //     });


        //     // 1. Open modal by clicking the button
        //     cy.contains('button', 'Add Missing Products').click();

        //     // 2. Verify modal structure and basic elements
        //     cy.get('[role="alertdialog"]')
        //         .should('be.visible')
        //         .within(() => {
                    

        //             // 3. Validate header section
        //             cy.contains('h2', 'Add Missing Product')
        //                 .should('be.visible');
        //             cy.get('button').contains('X')
        //                 .should('be.visible');

        //             // 4. Validate product selection label and dropdown
        //             cy.contains('label', 'Select Product')
        //                 .should('be.visible')
        //                 .should('contain', '*');

        //             // //    2. Check if dropdown is disabled and why
        //             // cy.get('.react-select__control').then(($control) => {
        //             //     if ($control.hasClass('react-select__control--is-disabled')) {
        //             //     // 3. Debug why it's disabled
        //             //     cy.log('Dropdown is disabled, checking parent container...');
        //             //     cy.get('.css-b62m3t-container')
        //             //         .should('not.have.class', 'react-select--is-disabled');
        //             //     }
        //             // });
                    
        //             // 5. Verify dropdown placeholder
        //             cy.get('.react-select__placeholder')
        //                 .should('contain', 'Search or select a product...');

        //             // Wait for dropdown to be enabled
        //             cy.get('.react-select__control')
        //             // .should('not.have.class', 'react-select__control--is-disabled', { timeout: 10000 });
        //             // cy.get('.react-select__control').should('not.have.class', 'react-select__control--is-disabled');

        //             // 6. Click to open dropdown
        //             cy.get('.react-select__dropdown-indicator').click({ multiple: true });

        //             // 7. Get all product options and randomly select one
        //             cy.get('.react-select__menu')
        //                 .within(() => {
        //                     cy.get('.react-select__option')
        //                         .should('have.length.gt', 0)
        //                         .then(($options) => {
        //                             const randonIndex = Math.floor(Math.random() * $options.length);
        //                             const selectedProduct = $options[randonIndex].innerText;

        //                             cy.wrap($options[randonIndex])
        //                                 .click()
        //                                 .then(() => {
        //                                     // 8. Verify selected product appears in input
        //                                     cy.get('.react-select__single-value')
        //                                     .should('contain', selectedProduct);

        //                                     // 9. Verify dependent fields are now enabled
        //                                     cy.get('input[placeholder="Qty"]')
        //                                     .should('not.be.disabled');

        //                                     // 10. Store selected product for later use
        //                                     Cypress.env('selectedProduct', selectedProduct);

        //                                 });
        //                         });
        //                 });
            
        //         });

        //         // 8. Verify disabled fields until product is selected
        //         cy.get('#add-item-make-select').should('be.disabled');
        //         cy.get('input[placeholder="Unit"]').should('be.disabled');
        //         cy.get('nput[placeholder="Qty"]').should('be.disabled');

        //         // 9. Test Create New Product link
        //         cy.contains('button', 'Create New Product')
        //             .should('be.visible')
        //             .and('have.class', 'text-blue-600');

        // });


          it('tests Add Missing Products modal with product selection and approves a PR', () => {
            // Navigate to PR details
            cy.get('[data-cy="procurement-requests-button"]').click();
            cy.get('[data-cy="procurement-requests-data-table"] tbody tr:first-child a[href^="/procurement-requests/PR-"]')
              .should('be.visible')
              .click();

            // Validate Add Missing Products button
            cy.contains('button', 'Add Missing Products')
              .should('be.visible')
              .and('have.class', 'bg-blue-600')
              .and('not.be.disabled');
        

            // Set up intercept BEFORE opening modal
            // cy.intercept('POST', '**/Procurement%20Requests/**').as('saveRequest');
            
            // Catch ALL POST requests for debugging
            // cy.intercept('POST', '**', (req) => {
            //     cy.log('POST request to:', req.url);
            // }).as('debug');
          
          
            // Open the modal
            cy.contains('button', 'Add Missing Products').click();
          
            // Work with the modal
            cy.get('[role="alertdialog"]')
              .should('be.visible')
              .within(() => {
                // Verify modal structure
                cy.contains('h2', 'Add Missing Product').should('be.visible');
                cy.get('button').contains('X').should('be.visible');
                cy.contains('label', 'Select Product').should('be.visible');
          
                // 1. Focus and type in the search input
                // cy.get('#react-select-3-input')
                cy.get('.css-art2ul-ValueContainer2')
                  .first()
                  .click(/** { force: true } **/)
                //   .type(' ', { force: true }); // Type space to trigger dropdown
          
                // 2. Wait for options to appear and select first product
                cy.get('div', { timeout: 10000 })
                    .should('have.length.gt', 0)
                    .then(($products) => {
                        const productCount = $products.length;
                        const randomIndex = Math.floor(Math.random() * productCount);
                        const randomProduct = $products[randomIndex];
                        const randomProductText = $products[randomIndex].textContent;

                        cy.wrap(randomProduct).click({ force: true });
                        Cypress.env('selectedProduct', randomProductText);


                        // .first()
                        // .then(($firstProduct) => {
                        //     const productName = $firstProduct.text().trim();
                        //     // 3. Click the first product
                        //     cy.wrap($firstProduct).click();                
                        //     Cypress.env('selectedProduct', productName);


                    });

                // Check if the dropdown is disabled 
                cy.get('.react-select__control').then(($control) => {
                    if($control.hasClass('react-select__control--is-disabled')){
                        cy.log('Dropdown is disabled - enable it first');
                    }
                });

                // Interaction with the dropdown
                cy.get('#add-item-make-select').click({force: true});

                // Wait for options to appear and select the first one
                cy.get('.react-select__menu')
                    .find('.react-select__option')
                    .first()
                    .click();


                const randomQty = Math.floor(Math.random() * 6) + 1;
                
                cy.get('input[type="number"]')
                    .should('be.visible')
                    .type(String(randomQty));
          
                // Verify dependent fields are now enabled
                cy.get('#add-item-make-select').should('not.be.disabled');
                cy.get('input[placeholder="Unit"]').should('not.be.disabled');
                cy.get('input[placeholder="Qty"]').should('not.be.disabled');

                // Test Create New Product link
                cy.contains('button', 'Create New Product')
                  .should('be.visible')
                  .and('have.class', 'text-blue-600');
                  
                // Test Cancel button
                cy.contains('button', 'Cancel')
                    .should('be.visible')
                    // .click();

                // Setting up intercept BEFORE the action that triggers the API call
                // cy.intercept('POST', '**/Procurement%20Requests/**').as('saveRequest');
                    
                // Test Cancel button
                cy.contains('button', 'Add Product')
                    .should('be.visible')
                    .click();

              });


                cy.contains('Item Added')
                    // .should('exist')
                    .and('be.visible');
                cy.log('Misssing Item Added Successfully......');
                    
                // // Wait for the API call to complete
                // cy.wait('@saveRequest', { timeout: 15000 });
                cy.wait(1000); 
                // cy.intercept('GET', '/api/resource/Procurement%20Requests/PR-*').as('refresh');
                // cy.wait('@refresh');

                // cy.wait('@debug').then((interception) => {
                //     cy.log('Actual request: ', interception.request.url);
                // });


                // --- WAIT FOR MODAL TO CLOSE ---
                cy.get('[role="alertdialog"]').should('not.exist');
                cy.log('Add Missing Item Dialog Closed Properly');

            
                // Test PR Action buttons after adding missing product
                // Test Delete PR button
                cy.get('[data-cy="delete-pr-button"]', { timeout: 16000 })
                    .should('be.visible')
                    .then(($button) => {
                        const isDisabled = $button.attr('disabled') ||
                                           $button.hasClass('disbled') ||
                                           $button.css('pointer-events') === 'none';

                        if(isDisabled) {
                            cy.log('Delete PR Button state:', {
                                disabledAttr: $button.attr('disabled'),
                                disabledClass: $button.hasClass('disabled'),
                                pointerEvents: $button.css('pointer-events'),
                                opacity: $button.css('opacity')
                            });
                        } else {
                            cy.wrap($button)
                                // .should('have.attr', 'disabled')
                                // .should('not.have.css', 'pointer-events', 'none')
                                .click();
                        }
                    });
                    cy.contains('button', 'Confirm Delete')
                        .should('exist')
                        .and('be.visible')
                        // .click()
                    cy.contains('button', 'Cancel')
                        .should('exist')
                        .and('be.visible')
                        .click();

                // Test Reject PR button
                cy.get('[data-cy="reject-pr-button"]', { timeout: 16000 })
                    .should('be.visible')
                    .then(($buttonRejectPR) => {
                        const isDisabled = $buttonRejectPR.attr('disabled') ||
                                           $buttonRejectPR.hasClass('disbled') ||
                                           $buttonRejectPR.css('pointer-events') === 'none';

                        if(isDisabled) {
                            cy.log('Reject PR Button state:', {
                                disabledAttr: $buttonRejectPR.attr('disabled'),
                                disabledClass: $buttonRejectPR.hasClass('disabled'),
                                pointerEvents: $buttonRejectPR.css('pointer-events'),
                                opacity: $buttonRejectPR.css('opacity')
                            });
                        // } else {   
                            cy.wrap($buttonRejectPR)
                                // .should('have.attr', 'disabled')
                                // .should('not.have.css', 'pointer-events', 'none')
                                .click({force: true});
                        }
                    });
                    cy.contains('Confirm Rejection')
                        .should('exist')
                        .and('be.visible')
                        // .click()
                    cy.contains('button', 'Cancel')
                        .should('exist')
                        .and('be.visible')
                        .click();

                // Test Approve PR button
                cy.get('[data-cy="approve-pr-button"]', { timeout: 16000 })
                    .should('be.visible')
                    .then(($buttonApproveButton) => {
                        const isDisabled = $buttonApproveButton.attr('disabled') ||
                                        $buttonApproveButton.hasClass('disabled') ||
                                        $buttonApproveButton.css('pointer-events') === 'none';

                        if(isDisabled) {
                            cy.log('Approve PR Button state:', {
                                disabledAttr: $buttonApproveButton.attr('disabled'),
                                disabledClass: $buttonApproveButton.hasClass('disabled'),
                                pointerEvents: $buttonApproveButton.css('pointer-events'),
                                opacity: $buttonApproveButton.css('opacity')
                            });
                        // } else {
                            cy.wrap($buttonApproveButton)
                                // .should('not.have.attr', 'disabled')
                                // .should('not.have.css', 'pointer-events', 'none')
                                .click();
                        }
                    });
                    cy.contains('button', 'Cancel')
                        .should('exist')
                        .and('be.visible')
                        // .click();
                    cy.contains('button', 'Confirm Approval')
                        .should('exist')
                        .and('be.visible')
                        // .click()

                // Checking Approve PR Message
                // cy.contains('PR Approved')
                //     .should('exist')
                //     .and('be.visible');
          
          });
});