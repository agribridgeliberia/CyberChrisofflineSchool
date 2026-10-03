window.customConfirm = function ({ title = 'Confirm action', message = '', okText = 'OK', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const previousFocus = document.activeElement
    const overlay = document.createElement('div')
    overlay.className = 'custom-confirm-overlay'

    const dialog = document.createElement('section')
    dialog.className = 'custom-confirm-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'customConfirmTitle')

    const heading = document.createElement('h2')
    heading.id = 'customConfirmTitle'
    heading.className = 'custom-confirm-title'
    heading.textContent = title

    const messageElement = document.createElement('p')
    messageElement.className = 'custom-confirm-message'
    messageElement.textContent = message

    const actions = document.createElement('div')
    actions.className = 'custom-confirm-actions'

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'btn btn-outline-secondary'
    cancelButton.textContent = cancelText

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = 'btn btn-new'
    confirmButton.textContent = okText

    actions.append(cancelButton, confirmButton)
    dialog.append(heading, messageElement, actions)
    overlay.append(dialog)
    document.body.append(overlay)

    let settled = false
    const finish = confirmed => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', handleKeydown)
      overlay.remove()
      window.focus()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
      resolve(confirmed)
    }

    const handleKeydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
        return
      }

      if (event.key === 'Tab') {
        const firstButton = cancelButton
        const lastButton = confirmButton
        if (event.shiftKey && document.activeElement === firstButton) {
          event.preventDefault()
          lastButton.focus()
        } else if (!event.shiftKey && document.activeElement === lastButton) {
          event.preventDefault()
          firstButton.focus()
        }
      }
    }

    cancelButton.addEventListener('click', () => finish(false))
    confirmButton.addEventListener('click', () => finish(true))
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(false)
    })
    document.addEventListener('keydown', handleKeydown)
    cancelButton.focus()
  })
}