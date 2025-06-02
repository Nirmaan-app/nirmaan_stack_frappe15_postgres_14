// <reference types="Cypress" />

import cypress from "cypress";

const emailVq = Cypress.env('login_Email');
const passwordVq = Cypress.env("login_Password");

describe('Adding Vendor Quotes for New PR Request', () => {

    beforeEach( () => {

        //Loging In
        cy.intercept('POST', '**/api/method/login').as('loginRequest');
        cy.visit('/login');

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailVq);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(passwordVq);
        cy.get('[data-cy="login-button"]').should('be.visible').click();

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');

    });

    it('Navigates to Procurement Requests Page, New PR Request and add Vendor Quotes', () => {

        // Navigating to Procurement Requests Page
        cy.get('[data-cy="procurement-requests-button"]')
            .should('be.visible').click();

        // Validating Right Page using Search Bar
        cy.get('[data-cy="procurement-requests-search-bar"]')
            .should('be.visible');

        // Navigating to New PR Requests page/container
        cy.get('[data-cy="new-pr-request-navigation"]')
            .should('exist')
            .and('be.visible')
            .click();
        
        // Validating Data-Table 
        cy.get('[data-cy="procurement-requests-data-table"]').should('exist').within(() => {
            cy.get('thead').should('exist');
            cy.get('tbody tr').should('have.length.at.least', 1);
            cy.contains('th', '#PR').should('be.visible');
            cy.contains('th', 'Created').should('be.visible');
        });

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
        cy.contains('Summary', { timeout: 10000 }).should('be.visible');

        // Validating the 'Delete PR' button using data-cy attribute
        cy.get('[data-cy="delete-pr-procurement-vendor"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Check the Heading text of the Dialog
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-text"]')
        .should('exist')
        .and('be.visible')
        .and('have.text', 'Delete Procurement Request')
        
        // Check Confirm Approval button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-confirm"]')
            .should('exist')
            .and('be.visible')
            // .click();

        
        // Check Cancel button visibility in Dialog Box
        cy.get('[data-cy="delete-pr-procurement-vendor-dialog-cancel"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Validating Continue Button and Clicking to navigate to Next Page
        cy.get('[data-cy="procurement-vendor-continue-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Selecting Vendors
        cy.get('[data-cy="vendore-quote-vendor-selection-button"]')
            .should('exist')
            .and('be.visible')
            .should('not.be.disabled')
            .click();

        // Vendor Selection Dialog --->
        // Step 1: Check for the heading
        cy.contains('[data-cy="vendor-addition-text"]', 'Add Vendors')
            .should('exist')
            .and('be.visible');
        
        // Pick two random characters from a-y
        const characters = 'abcdefghijklmnopqrstuvwxy'.split('');
        const randomChars = Cypress._.sampleSize(characters, 2);

        // Type into dropdown input and select first visible option
        randomChars.forEach( char => {
            cy.get('[data-cy="vendor-addition-dropdown')
                .click()
                // .clear()
                .type(char);

        // Waiting for dropdown menu and then selecting the first option
        cy.get('.css-1nmdiq5-menu')
            // .siblings()
            .find('div')
            .first()
            .click();
        });

        // // Confirming that two vendors are selected
        // cy.get('.css-art2ul-ValueContainer2 div')
        //     .should('have.length', 2);
        
        // Validating Vendor Selection Cancel Button
        cy.get('[data-cy="vendor-selection-cancel-button"]')
            .should('exist')
            .and('be.visible')
            // .click();

        // Validating Vendor Selection Confirm Button
        cy.get('[data-cy="vendor-selection-confirm-button"]')
            .should('exist')
            .and('be.visible')
            .click();


        // Filling Vendor Quotes --->
        // Get all item rows
        cy.get('tbody tr')
            .then(($rows) => {
                const itemCount = $rows.length;
                cy.log(`Found ${itemCount} items to Process`);
                // Process each row sequentially
                Cypress._.times(itemCount, (rowIndex) => {
                    cy.get('tbody tr').eq(rowIndex)
                        .then(($row) => {
                            // Get vendor card count for this row
                            const vendorCardCount = $row.find('[data-cy="vendor-quote-rate"]').length;
                            cy.log(`Processing item ${rowIndex + 1} with ${vendorCardCount} vendors`);

                            // Process each vendor card in this row
                            Cypress._.times(vendorCardCount, (vendorIndex) => {
                                cy.get('tbody tr').eq(rowIndex)
                                    .within(() => {
                                        cy.get('[role="radio"]').eq(vendorIndex)
                                            .within(() => {

                                                // 1. Select first Make option
                                                cy.get('.css-b62m3t-container')
                                                    .click();
                                                cy.get('.css-w9q2zk-Input2')
                                                    .first()
                                                    .click();
                                            
                                                // 2. Enter random rate between 63-330
                                                const randomRate = Math.floor(Math.random() * (330 - 63 + 1)) + 63;
                                                cy.get('[data-cy="vendor-quote-rate"]')
                                                    .clear()
                                                    .type(randomRate.toString());
                                            });
                                    });
                            });
                        });
                });
            });

        // Additional validation check for rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).find('[data-cy="vendor-quote-rate"]')
                .each(($rateInput) => {
                    cy.wrap($rateInput).should('not.have.value', '');
                });
        });
        

        // Navigating to View Page
        // Verify Edit becomes active and View becomes inactive
        cy.get('[data-cy="vendor-quotes-edit-button"]')
            .scrollIntoView()
            .should('exist')
            .and('be.visible');
            // .should('have.class', 'bg-red-100');

        cy.get('[data-cy="vendor-quotes-view-button"]')
            .scrollIntoView()
            .should('not.have.class', 'bg-red-100');

        // View Button
        cy.get('[data-cy="vendor-quotes-view-button"]')
            .should('exist')
            .and('be.visible')
            .click();

        // Selecting Minimum Rates Cards
        // cy.get('tbody tr').each(($row) => {
        //     cy.wrap($row).within(() => {
        //       const vendorCards = [];
              
        //       // Updated selector to match your actual DOM structure
        //       cy.get('[role="radio"]').each(($card) => {
        //         cy.wrap($card).within(() => {
        //           // More precise selector based on your HTML structure
        //           cy.get('div.flex.flex-col.gap-1:has(label:contains("Rate"))').within(() => {
        //             cy.get('p').invoke('text').then((rateText) => {
        //               const rate = parseFloat(rateText.replace(/[^0-9.]/g, ''));
        //               vendorCards.push({ element: $card, rate });
        //             });
        //           });
        //         });
        //       }).then(() => {
        //         if (vendorCards.length > 0) {
        //           const minRateCard = vendorCards.reduce((min, card) => 
        //             card.rate < min.rate ? card : min, vendorCards[0]);
                  
        //           cy.wrap(minRateCard.element).click();
                  
        //           // Verify selection - adjust this based on your actual selected state indicator
        //           cy.wrap(minRateCard.element)
        //             .find('.lucide-circle-check')
        //             .should('be.visible');
        //         }
        //       });
        //     });
        //   });

        // Updated Code for selecting Minimum Rates
        cy.get('tbody tr').each(($row) => {
            cy.wrap($row).within(() => {
              const vendorCards = [];
          
              cy.get('[role="radio"]').each(($card) => {
                cy.wrap($card).then(($el) => {
                  // Get the rate value by finding label: "Rate" and its sibling p
                  const labelEls = $el.find('label');
          
                  labelEls.each((_, label) => {
                    if (Cypress.$(label).text().trim() === 'Rate') {
                      const rateText = Cypress.$(label).next('p').text().trim();
                      const rate = parseFloat(rateText.replace(/[^0-9.]/g, ''));
                      vendorCards.push({ element: $card, rate });
                    }
                  });
                });
              }).then(() => {
                if (vendorCards.length > 0) {
                  const minRateCard = vendorCards.reduce((min, card) =>
                    card.rate < min.rate ? card : min, vendorCards[0]);
          
                  cy.wrap(minRateCard.element).click();
          
                  // Optionally verify selection if checkmark icon appears
                  cy.wrap(minRateCard.element)
                    .find('.lucide-circle-check')
                    .should('be.visible');
                }
              });
            });
          });
          
        
        // Revert and Continue Button
        cy.get('[data-cy="revert-pr-button"]')
          .should('exist')
          .and('be.visible')
          .click();

            // Revert PR Dialog - Box
            cy.get('[data-cy="revert-pr-dialog-text"]')
                .should('exist')
                .and('be.visible');
            
            // Revert PR cancel and confirm
            cy.get('[data-cy="revert-pr-dialog-confirm-button"]')
                .should('exist')
                .and('be.visible')
                // .click();

            cy.get('[data-cy="revert-pr-dialog-cancel-button"]')
                .should('exist')
                .and('be.visible')
                .click();

        // Validationg Continue Button
        cy.get('[data-cy="vendor-selection-continue-button"]')
          .should('exist')
          .and('be.visible')
          .should('not.be.disabled')
          .click();

        // Validation Vendor Selection Summary Send For Approval Button
        cy.get('[data-cy="vendor-selection-summary-send-for-approval-button"]')
          .should('exist')
          .and('be.visible')
          .should('contain.text', 'Send for Approval')
          .click();

            cy.get('[data-cy="send-for-approval-dialog-text"]')
                .should('exist')
                .and('be.visible');

                // Target the textarea using its class and placeholder
                cy.get('textarea[placeholder="type here..."].ant-input')
                    .should('be.visible')
                    .and('have.class', 'border-green-400')
                    .clear()
                    .type('This PR is sent for approval by Test - Automation flow...')
                    .should('have.value', 'This PR is sent for approval by Test - Automation flow...');

                // cy.get('[data-cy="send-for-approval-dialog-remarks-input"]')
                //     .should('exist')
                //     .and('be.visible')
                //     .clear()
                //     .type('This PR is sent for approval by Test - Automation flow');

                    cy.get('[data-cy="send-for-approval-dialog-cancel-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Cancel')
                        // .click();

                    cy.get('[data-cy="send-for-approval-dialog-confirm-button"]')
                        .should('exist')
                        .and('be.visible')
                        .should('contain.text', 'Confirm')
                        .click();
                    cy.contains('Success!')
                        .should('exist')
                        .and('be.visible');
                        
    });

});