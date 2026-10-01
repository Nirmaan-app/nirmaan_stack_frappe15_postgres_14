import { forwardRef } from "react";
import { Link, LinkProps, useLocation, useParams } from "react-router-dom";

import { orderDetailPath } from "./poRoute";

type OrderDetailLinkProps = Omit<LinkProps, "to"> & { docName: string };

/**
 * A link to a PO / WO from a shared report table; the route follows the page it renders on
 * (`orderDetailPath`). Forwards its ref so it can sit under a Radix `asChild` trigger.
 */
export const OrderDetailLink = forwardRef<HTMLAnchorElement, OrderDetailLinkProps>(
  ({ docName, ...rest }, ref) => {
    const { pathname } = useLocation();
    const { projectId } = useParams();
    return <Link ref={ref} to={orderDetailPath(docName, pathname, projectId)} {...rest} />;
  },
);
OrderDetailLink.displayName = "OrderDetailLink";
