import { useRef, useState } from 'react'
import { Camera, Check, Image as ImageIcon, Trash2, User } from 'lucide-react'

type AvatarPickerProps = {
  currentPhoto?: string
  onPhotoChange: (photoDataUrl: string) => void
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=250&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=250&auto=format&fit=crop&q=80',
]

export function AvatarPicker({ currentPhoto, onPhotoChange }: AvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      alert('File size too large. Please select an image under 5MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onPhotoChange(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative group">
          <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-[#0c6b7a]/20 bg-slate-100 shadow-md flex items-center justify-center">
            {currentPhoto ? (
              <img src={currentPhoto} alt="Profile preview" className="h-full w-full object-cover" />
            ) : (
              <User className="h-12 w-12 text-slate-400" />
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-0 right-0 p-2 rounded-full bg-[#0c6b7a] text-white shadow-lg hover:bg-[#09525e] transition"
            title="Upload photo"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 text-center sm:text-left">
          <h4 className="text-sm font-bold text-slate-900">Profile Photo</h4>
          <p className="text-xs text-slate-500 max-w-xs">Upload a personal photo or select one of the avatar presets below.</p>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <ImageIcon className="h-3.5 w-3.5 text-[#0c6b7a]" />
              Upload Image
            </button>
            <button
              type="button"
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Web Link
            </button>
            {currentPhoto && (
              <button
                type="button"
                onClick={() => onPhotoChange('')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-600 hover:bg-red-100 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {showUrlInput && (
        <div className="flex gap-2">
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Paste image URL (https://...)"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#0c6b7a]"
          />
          <button
            type="button"
            onClick={() => {
              if (customUrl.trim()) {
                onPhotoChange(customUrl.trim())
                setShowUrlInput(false)
                setCustomUrl('')
              }
            }}
            className="px-3 py-2 rounded-xl bg-[#0c6b7a] text-white text-xs font-semibold"
          >
            Apply
          </button>
        </div>
      )}

      <div>
        <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Avatar Presets</span>
        <div className="grid grid-cols-6 gap-2">
          {PRESET_AVATARS.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onPhotoChange(url)}
              className={`relative h-12 w-12 rounded-full overflow-hidden border-2 transition ${
                currentPhoto === url ? 'border-[#0c6b7a] ring-2 ring-[#0c6b7a]/30' : 'border-transparent hover:border-slate-300'
              }`}
            >
              <img src={url} alt={`Preset ${idx + 1}`} className="h-full w-full object-cover" />
              {currentPhoto === url && (
                <div className="absolute inset-0 bg-[#0c6b7a]/40 flex items-center justify-center">
                  <Check className="h-4 w-4 text-white" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
