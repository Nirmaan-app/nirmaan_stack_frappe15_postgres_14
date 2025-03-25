import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SITEURL from '@/constants/siteURL';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { Vendors } from '@/types/NirmaanStack/Vendors'; // Assuming you have a Vendor type
import { useDialogStore } from '@/zustand/useDialogStore'; // Assuming you have a dialog store
import { CheckCheck, Share } from 'lucide-react';
import React, { useState } from 'react';

interface SharePaymentCellProps {
  data: ProjectPayments ;
  vendors?: Vendors[];
}

const SharePaymentCell: React.FC<SharePaymentCellProps> = ({ data, vendors }) => {
  const { toggleShareDialog, shareDialog } = useDialogStore();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const handleShareClick = () => {
    const vendorNumber = vendors?.find((i) => i?.name === data?.vendor)?.vendor_mobile || '';
    setPhoneNumber(vendorNumber);
    setScreenshotUrl(data?.payment_attachment || null); // Set screenshot URL
    toggleShareDialog();
  };

  const handleOpenWhatsApp = () => {
    if (phoneNumber) {
      window.open(`https://wa.me/${phoneNumber}`, '_blank');
    }
  };

  return (
    <div>
      {
        data.status === 'Paid' && (
          <button onClick={handleShareClick} className="text-blue-500 cursor-pointer">
            <Share className="text-blue-500 cursor-pointer" />
          </button>
        )
      }
      <Dialog open={shareDialog} onOpenChange={toggleShareDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="text-center">Share Payment Screenshot via WhatsApp</DialogTitle>
                  <DialogDescription className="text-center">
                    {screenshotUrl && (
                      <div className="flex justify-center mb-4">
                        <img
                          src={`${SITEURL}${screenshotUrl}`}
                          alt="Payment Screenshot"
                          className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                        />
                      </div>
                    )}
                    Download the Payment Screenshot and send it via WhatsApp to
                    <div className="ml-4 flex items-center gap-2 my-2">
                      <Label>Mobile: </Label>
                      <Input
                        className=""
                        type="text"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="Enter phone number"
                      />
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-center space-x-4">
                  <Button
                    disabled={!phoneNumber}
                    onClick={handleOpenWhatsApp}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCheck className="h-4 w-4 mr-2" />
                    Open WhatsApp
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
    </div>
  );
};

export default SharePaymentCell;