import { FrappeProvider } from 'frappe-react-sdk'
import { Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'
import Dashboard from './pages/dashboard'
import Login from './pages/auth/old-login'
import Projects from './pages/projects/projects'
import Customers from './pages/customers/customers'
import WorkPackages from './pages/work-packages'
import Profile from './pages/users/user-profile'
import { EditProjectForm } from './pages/projects/edit-project-form'
import { ApprovePR } from './pages/approve-pr'
import { PRList } from './components/procurement/procurement-approved'
import { ProcurementOrder } from './components/procurement/procurement-vendor'
import { SelectVendors } from './components/procurement/select-vendors'
import { UpdateQuote } from './components/procurement/update-quote'
import { SentBackRequest } from './components/procurement/sent-back-request'
import { SentBackUpdateQuote } from './components/procurement/sent-back-update-quote'
import { SentBackSelectVendor } from './components/procurement/sent-back-select-vendor'
import { ReleasePOSelect } from './components/procurement/release-po-select'
import { QuoteUpdateSelect } from './components/procurement/quote-update-select'
import { SelectVendorList } from './components/procurement/select-vendor-list'
import { ApproveSelectSentBack } from './pages/approve-select-sent-back'
import { PDF } from './pages/pdf'
import { ThemeProvider } from './components/ui/theme-provider'
import { ProtectedRoute } from './utils/auth/ProtectedRoute'
import { UserProvider } from './utils/auth/UserProvider'
import Users from './pages/users/users'
import Roles from './pages/roles'
import Debug from './pages/debug'
import { ApproveSelectVendor } from './pages/approve-select-vendor'
import { UserForm } from './pages/users/user-form'
import Items from './pages/Items/items'
import Vendors from './pages/vendors/vendors'
import ListPR from './components/procurement-request/list-pr'
import { EditVendor } from './pages/vendors/edit-vendor'
import { FC, useEffect } from 'react'
import { MainLayout } from './components/layout/main-layout'
import { ProjectManager } from './components/dashboard-pm'
import { DelayedPRSelect } from './pages/delayed-pr-select'
import { DelayedPR } from './pages/delayed-pr'
import NewCustomer from './pages/customers/add-new-customer'
import EditCustomer from './pages/customers/edit-customer'
import { NewVendor } from './pages/vendors/new-vendor'
import NewMilestones from './components/updates/NewMilestones'
import DeliveryNotes from './pages/DeliveryNotes/deliverynotes'
import DeliveryNote from './pages/DeliveryNotes/deliverynote'
import { ProjectForm } from './pages/projects/project-form'
import { ReleasePONew } from './components/updates/ReleasePONew'
import { ApprovedQuotationsTable } from './pages/ApprovedQuotationsFlow/ApprovedQuotationsTable'
import EditUserForm from './pages/users/EditUserForm'
import { messaging } from './firebase/firebaseConfig'
import { onMessage } from 'firebase/messaging'
import { ApproveSelectAmendPO } from './pages/approve-select-amend-po'
import { POSummary } from './components/POSummary'
import ListSR from './components/service-request/list-sr'
import { ApproveSelectSR } from './components/service-request/approve-service-request-list'
import { ApproveServiceRequest } from './components/service-request/approve-service-request'
import { SelectServiceVendorList } from './components/service-request/select-service-vendor-list'
import { ApprovedSRList } from './components/service-request/approved-sr-list'
import { ApprovedSR } from './components/service-request/approved-sr'
import { SidebarProvider } from './components/ui/sidebar'
import { SentBackSummary } from './components/procurement/sent-back-summary'
import { ManPowerReport } from './components/ManPowerReport'

const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			<Route path='/login' element={<Login />} />
			<Route path='/forgot-password' lazy={() => import('@/pages/auth/forgot-password')} />
			<Route path='/' element={<ProtectedRoute />}>

				<Route path='/' element={<MainLayout />}>

					<Route index element={<Dashboard />} />

					{/* PRs & Milestones Paths */}
					<Route path='prs&milestones'>
						<Route index element={<ProjectManager />} />
						{/* Procurement Request Paths */}
						<Route path="procurement-requests">
							<Route index element={<ListPR />} />
							<Route path=":id/new" lazy={() => import('@/components/procurement-request/new-pr')} />
							<Route path=":id">
								<Route index lazy={() => import('@/components/pr-summary')} />
								<Route path=":id" element={<POSummary />} />
							</Route>
						</Route>

						{/* Delivery Notes Paths */}
						<Route path='delivery-notes'>
							<Route index element={<DeliveryNotes />} />
							<Route path=":id" element={<DeliveryNote />} />
						</Route>
						<Route path='man-power-report' element={<ManPowerReport />} />
					</Route>

					{/* Service Requests Paths */}
					<Route path='service-requests'>
						<Route index element={<ListSR />} />
						<Route path=":project/new" lazy={() => import('@/components/service-request/new-service-request')} />
						<Route path=":id" lazy={() => import('@/components/service-request/sr-summary')} />
					</Route>

					<Route path='choose-service-vendor'>
						<Route index element={<SelectServiceVendorList />} />
						<Route path=":id" lazy={() => import('@/components/service-request/select-service-vendor')} />
					</Route>

					{/* Approve PR Paths  */}
					<Route path="approve-new-pr">
						<Route index element={<ApprovePR />} />
						<Route path=":id" lazy={() => import('@/pages/approve-order')} />
					</Route>

					{/* Approve PO Paths  */}
					<Route path="approve-po">
						<Route index element={<ApproveSelectVendor />} />
						<Route path=":orderId" lazy={() => import('@/pages/approve-vendor')} />
					</Route>

					{/* Approve Amended PO Paths  */}
					<Route path="approve-amended-po">
						<Route index element={<ApproveSelectAmendPO />} />
						<Route path=":po" lazy={() => import('@/pages/approve-amend-po')} />
					</Route>

					{/* Approve Sent Back Paths  */}
					<Route path="approve-sent-back">
						<Route index element={<ApproveSelectSentBack />} />
						<Route path=":id" lazy={() => import('@/pages/approve-sent-back')} />
					</Route>

					{/* Approve Service Request Paths  */}
					<Route path="approve-service-request">
						<Route index element={<ApproveSelectSR />} />
						<Route path=":id" element={<ApproveServiceRequest />} />
					</Route>

					<Route path='approved-sr'>
						<Route index element={<ApprovedSRList />} />
						<Route path=":id" element={<ApprovedSR />} />
					</Route>

					{/* New PR Request Paths  */}
					<Route path="new-procure-request">
						<Route index element={<PRList />} />
						<Route path=":orderId" element={<ProcurementOrder />} />
					</Route>

					{/* Update Quote Paths  */}
					<Route path='update-quote'>
						<Route index element={<QuoteUpdateSelect />} />
						<Route path=":orderId" element={<UpdateQuote />} />
					</Route>

					{/* Select Vendor Paths  */}
					<Route path="choose-vendor">
						<Route index element={<SelectVendorList />} />
						<Route path=":orderId" element={<SelectVendors />} />
					</Route>

					{/* Approved PO Paths  */}
					<Route path="approved-po">
						<Route index element={<ReleasePOSelect not={false} status="PO Approved" />} />
						<Route path=":id" element={<ReleasePONew not={false} />} />
					</Route>

					{/* Released PO Paths  */}
					<Route path="released-po">
						<Route index element={<ReleasePOSelect not={true} status="PO Approved" />} />
						<Route path=":id" element={<ReleasePONew not={true} />} />
					</Route>

					{/* Sent Back Paths */}
					<Route path='rejected-sb'>
						<Route index element={<SentBackRequest type="Rejected" />} />
						<Route path=":id">
							<Route index element={<SentBackSummary />} />
							<Route path="update-quote">
								<Route index element={<SentBackUpdateQuote />} />
								<Route path="choose-vendor" element={<SentBackSelectVendor />} />
							</Route>
						</Route>
					</Route>

					<Route path='delayed-sb'>
						<Route index element={<SentBackRequest type="Delayed" />} />
						<Route path=":id">
							<Route index element={<SentBackSummary />} />
							<Route path="update-quote">
								<Route index element={<SentBackUpdateQuote />} />
								<Route path="choose-vendor" element={<SentBackSelectVendor />} />
							</Route>
						</Route>
					</Route>

					<Route path='cancelled-sb'>
						<Route index element={<SentBackRequest type="Cancelled" />} />
						<Route path=":id">
							<Route index element={<SentBackSummary />} />
							<Route path="update-quote">
								<Route index element={<SentBackUpdateQuote />} />
								<Route path="choose-vendor" element={<SentBackSelectVendor />} />
							</Route>
						</Route>
					</Route>

					{/* Project Paths */}
					<Route path="projects">
						<Route index element={<Projects />} />
						<Route path="new" element={<ProjectForm />} />
						<Route
							path=":projectId"
							lazy={() => import('@/pages/projects/project')}
						/>
						<Route path=":projectId/add-estimates" lazy={() => import('@/components/add-project-estimates')} />
						<Route path=":projectId/edit" element={<EditProjectForm />} />
						<Route path=":projectId/:id">
							<Route index lazy={() => import('@/components/pr-summary')} />
							<Route path=":id" element={<POSummary />} />
							<Route path="dn/:id" element={<DeliveryNote />} />
						</Route>
					</Route>

					{/* User Paths */}
					<Route path="users">
						<Route index element={<Users />} />
						<Route path="new" element={<UserForm />} />
						<Route path=":id" element={<Profile />} />
						<Route path=':id/edit' element={<EditUserForm />} />
					</Route>

					{/* Item Paths  */}
					<Route path="items" >
						<Route index element={<Items />} />
						<Route path=":itemId" lazy={() => import('@/pages/Items/item')} />
					</Route>

					{/* Vendor Paths  */}
					<Route path="vendors">
						<Route index element={<Vendors />} />
						<Route path="new" element={<NewVendor />} />
						<Route path=":vendorId" >
							<Route index lazy={() => import('@/pages/vendors/vendor')} />
							<Route path=":id" element={<POSummary />} />
						</Route>
						<Route path=":id/edit" element={<EditVendor />} />
					</Route>

					{/* Customer Paths */}
					<Route path="customers">
						<Route index element={<Customers />} />
						<Route path="new" element={<NewCustomer />} />
						<Route path=":customerId" lazy={() => import('@/pages/customers/customer')} />
						<Route path=":id/edit" element={<EditCustomer />} />
					</Route>

					<Route path="roles">
						<Route index element={<Roles />} />
					</Route>

					{/* Debug Paths  */}
					<Route path="debug">
						{/* <Route index element={<Debug />} /> */}
						<Route index element={<ApprovedQuotationsTable />} />
						<Route path=':id' element={<POSummary />} />
					</Route>

					{/* Other routes */}
					<Route path="wp" element={<WorkPackages />} />
					<Route path="pdf" element={<PDF />} />
					<Route path='milestone-update' element={<NewMilestones />} />
					<Route path="delayed-pr" element={<DelayedPRSelect />} />
					<Route path="delayed-pr/:id" element={<DelayedPR />} />

				</Route>
			</Route >
		</>
	), {
	basename: `/${import.meta.env.VITE_BASE_NAME}` ?? "",
}
)

const App: FC = () => {

	useEffect(() => {
		// Firebase onMessage handler for foreground notifications
		onMessage(messaging, (payload) => {
			console.log('Message received in the foreground: ', payload);

			const notificationTitle = payload?.notification?.title || "";
			const notificationOptions = {
				body: payload?.notification?.body,
				icon: payload?.notification?.icon || '../src/assets/red-logo.png',
				data: { click_action_url: payload?.data?.click_action_url }
			};

			const notification = new Notification(notificationTitle, notificationOptions);

			notification.onclick = () => {
				window.open(notificationOptions.data.click_action_url || "/", '_blank');
			};
		});
	}, []);

	const getSiteName = () => {
		// @ts-ignore
		// if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
		// 	// @ts-ignore
		// 	return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
		// }
		return window.frappe?.boot?.sitename !== undefined ? window.frappe?.boot?.sitename : import.meta.env.VITE_SITE_NAME
	}

	// const queryClient = new QueryClient()

	return (
		<FrappeProvider
			url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
			socketPort={import.meta.env.VITE_SOCKET_PORT ? import.meta.env.VITE_SOCKET_PORT : undefined}
			//@ts-ignore
			siteName={getSiteName()}>
			<UserProvider>
				<SidebarProvider>
					{/* <QueryClientProvider client={queryClient}> */}
					<ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
						<RouterProvider router={router} />
					</ThemeProvider>
					{/* </QueryClientProvider> */}
				</SidebarProvider>
			</UserProvider>
		</FrappeProvider>
	)
}

export default App