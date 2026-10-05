import { AppIcon } from '@/components/ui/AppIcon';
import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { useUI } from '@/store/ui';
import { useI18n } from '@/i18n/useI18n';
import { Modal, ModalFooter, SecondaryButton, PrimaryButton, DangerButton } from '@/components/ui/primitives';

export function ModalHost() {
  const { modal, resolveModal, dismissModal } = useUI();
  const { t } = useI18n();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (modal.prompt) setValue(modal.prompt.initialValue ?? '');
  }, [modal.prompt]);

  if (modal.confirm) {
    const { title, message, okText, cancelText, danger, hideCancel } = modal.confirm;
    return (
      <Modal open onClose={dismissModal}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0">
              <AppIcon className="fas fa-triangle-exclamation text-red-500" />
            </div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">{title}</h3>
          </div>
          {message ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed ml-[52px]">{message}</p>
          ) : null}
        </div>
        <ModalFooter>
          {!hideCancel ? (
            <SecondaryButton onClick={() => resolveModal(false)}>{cancelText || t('cancel')}</SecondaryButton>
          ) : null}
          {danger ? (
            <DangerButton onClick={() => resolveModal(true)}>{okText || t('ok')}</DangerButton>
          ) : (
            <PrimaryButton onClick={() => resolveModal(true)}>{okText || t('ok')}</PrimaryButton>
          )}
        </ModalFooter>
      </Modal>
    );
  }

  if (modal.prompt) {
    const { title, label, placeholder, okText, cancelText } = modal.prompt;
    return (
      <Modal open onClose={dismissModal}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resolveModal(value);
          }}
        >
          <div className="p-6">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-4">{title}</h3>
            {label ? (
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">{label}</label>
            ) : null}
            <Input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <ModalFooter>
            <SecondaryButton onClick={dismissModal}>{cancelText || t('cancel')}</SecondaryButton>
            <PrimaryButton type="submit">{okText || t('ok')}</PrimaryButton>
          </ModalFooter>
        </form>
      </Modal>
    );
  }

  return null;
}
