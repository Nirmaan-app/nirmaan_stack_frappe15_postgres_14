/// <reference types="Cypress" />

const emailCustomPr = Cypress.env('login_Email');
const passwordCustomPr = Cypress.env('login_Password')

describe('Test Flow for Approving a Custom Procurement Request', () => {

    beforeEach(() => {
        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailCustomPr);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordCustomPr);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');
    });

    it('should navigate to the Purchase Orders page', () => {

        // Step 1: Validate the Purchase Orders button exists and is visible
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .and('contain.text', 'Purchase Orders')
            // .and('have.class', 'bg-[#FFD3CC]')
            // .and('have.class', 'text-[#D03B45]');

        // Step 2: Click the button to go to the Purchase Orders page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Step 3: Confirm navigation occurred
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');
    });
    

    it('Navigates to next Page in PR table', () => {

        cy.get('[data-cy="purchase-orders-button"]').click();
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


    it('Navigates to Purchase Orders and Approves a custom Procurement Request', () => {

        // Validating Purchase Orders Button from sidebar
        cy.get('[data-cy="purchase-orders-button"]')
            .should('be.visible')
            .and('contain.text', 'Purchase Orders');

        // Navigating to Purchase Orders Page
        cy.get('[data-cy="purchase-orders-button"]')
            .click();

        // Validationg Navigation 
        cy.url().should('include', '/purchase-orders');
        cy.contains('PURCHASE-ORDERS')
            .should('exist')
            .and('be.visible');

        // Validating Approve PO Navigation Button is Active
        cy.get('[data-cy="approve-po-navigation"]')
            .should('be.visible')
            .closest('label')
            .should('have.class', 'ant-radio-button-wrapper-checked')
            .find('input[type="radio"]')
            .should('be.checked');

        // Search Bar Presence
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Data Table Presence
        cy.get('[data-cy="procurement-requests-data-table"]')
            .should('exist')
            .within(() => {
                cy.get('thead')
                    .should('exist');
                cy.get('tbody tr')
                    .should('have.length.at.least', 1);
                cy.contains('th', '#PR')
                    .should('be.visible');
                cy.contains('th', 'Created On')
                    .should('be.visible');
            });

            // Base Url 
            const baseUrl = Cypress.config('baseUrl');

            // Store PR details befor navigation
            let prNumber, expectedUrl

            // Get the first PR link Details
            cy.get('[data-cy="procurement-requests-data-table"] tbody tr')
                .first()
                .within( () => {
                    cy.get('a[href^="/purchase-orders/PR-"]')
                        .should('be.visible')
                        .then(($link) => {
                            prNumber = $link.text().trim();
                            const href = $link.attr('href');
                            expectedUrl = `${baseUrl}${decodeURIComponent(href)}`;

                            // Clicking on the PR Link ( For Navigation )
                            cy.wrap($link).click();
                        });
                });

            // After navigation Verifying the new page
            cy.url()
                .then(currentUrl => {
                    const decodedCurrentUrl = decodeURIComponent(currentUrl);
                    expect(decodedCurrentUrl).to.include(expectedUrl);
                })

            // Verify page content on the page
            cy.log(prNumber);
            // cy.contains(`PR-${prNumber}`, { timeout: 10000 })
            //     .should('be.visible');
            cy.contains(/^(Approve\/Reject Vendor Quotes|Approve\/Send Back Vendor Quotes)$/, { timeout: 10000 })
                .should('be.visible');

            // Click the Vendor Block
            cy.get('[data-cy="vendor-name-property"]')
                .should('exist')
                .and('be.visible')
                .first()
                .click();

            // Wait for the items table to be visible
            cy.get('[data-cy="items-name-table"] table tbody tr')
                .should('have.length.greaterThan', 0);

            // Check all unchecked checkboxes inside the table
            // First get all vendor sections and expand them if closed
            cy.get('[data-cy="vendor-name-property"]').each(($vendor) => {
                // Check if the vendor section is closed
                cy.wrap($vendor).then(($el) => {
                const isClosed = $el.attr('data-state') === 'closed';
                
                if (isClosed) {
                    // Click the vendor header to expand it
                    cy.wrap($el).find('h3 > button').click();
                }
                
                // Wait for the content to be visible (adjust timeout if needed)
                cy.wrap($el).find('[data-cy="items-name-table"]').should('be.visible');
                
                // Now check all unchecked checkboxes in this vendor's table
                cy.wrap($el).find('[data-cy="items-name-table"] table tbody tr').each(($row) => {
                    cy.wrap($row).within(() => {
                    cy.get('button[role="checkbox"]').then(($checkbox) => {
                        const isChecked = $checkbox.attr('aria-checked') === 'true';
                        if (!isChecked) {
                        cy.wrap($checkbox).click();
                        }
                    });
                    });
                });
                });
            });

            
            // Validaying Reject Button
            cy.get('[data-cy="reject-button"]')
                .should('exist')
                .and('be.visible')
                .should('not.be.disabled')
                // .click();
            
            // Validating Approve Button
            cy.get('[data-cy="approve-button"]')
                 .should('exist')
                 .and('be.visible')
                 .should('not.be.disabled')
                 .click();

            // Check the Heading text of the Dialog
            cy.get('div[role="alertdialog"] h2')
                .should('exist')
                .and('be.visible')
                .and('have.text', 'Confirm Approval?')
            
            // Check Cancel button visibility in Dialog Box
            cy.contains('button', 'Cancel')
                .should('exist')
                .and('be.visible')
                // .click();
            
            // Check Confirm Approval button visibility in Dialog Box
            cy.contains('button', 'Confirm Approval')
                .should('exist')
                .and('be.visible')
                .click();
            
    });

});