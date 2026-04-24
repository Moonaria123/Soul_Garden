'use client';

import { useEffect, useState, useCallback } from 'react';
import { useUserProfileStore } from '@/lib/store/user-profile-store';
import { AvatarUpload } from '@/components/entity/avatar-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Shield, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

export default function MePage() {
  const t = useT();
  const { profile, isLoading, loadProfile, saveProfile } = useUserProfileStore();
  const [isSaving, setIsSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [personality, setPersonality] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setNickname(profile.nickname || '');
      setAge(profile.age || '');
      setGender(profile.gender || '');
      setPersonality(profile.personality || '');
      setBio(profile.bio || '');
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveProfile({
        displayName: displayName.trim() || undefined,
        nickname: nickname.trim() || undefined,
        age: age.trim() || undefined,
        gender: gender.trim() || undefined,
        personality: personality.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      toast.success(t('me.saved'));
    } finally {
      setIsSaving(false);
    }
  }, [displayName, nickname, age, gender, personality, bio, saveProfile, t]);

  const handleAvatarUpload = useCallback(
    async (dataUrl: string) => {
      await saveProfile({ avatarUrl: dataUrl });
    },
    [saveProfile]
  );

  const handleAvatarRemove = useCallback(async () => {
    await saveProfile({ avatarUrl: undefined });
  }, [saveProfile]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground text-sm animate-pulse">{t('chat.loading')}</p>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold font-[family-name:var(--font-display)] text-foreground">
          {t('me.title')}
        </h1>
        <p className="text-muted-foreground text-sm mt-2">{t('me.subtitle')}</p>
      </div>

      <Card className="shadow-[var(--shadow-warm-md)]">
        <CardHeader className="items-center pb-2">
          <AvatarUpload
            avatarUrl={profile?.avatarUrl}
            name={displayName || nickname || '我'}
            size={80}
            onUpload={handleAvatarUpload}
            onRemove={profile?.avatarUrl ? handleAvatarRemove : undefined}
          />
        </CardHeader>

        <CardContent className="space-y-5 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">{t('me.displayName')}</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('me.displayNamePlaceholder')}
                className="bg-[hsl(var(--su-surface-2))]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nickname">{t('me.nickname')}</Label>
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('me.nicknamePlaceholder')}
                className="bg-[hsl(var(--su-surface-2))]"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="age">{t('me.age')}</Label>
              <Input
                id="age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder={t('me.agePlaceholder')}
                className="bg-[hsl(var(--su-surface-2))]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gender">{t('me.gender')}</Label>
              <Input
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                placeholder={t('me.genderPlaceholder')}
                className="bg-[hsl(var(--su-surface-2))]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="personality">{t('me.personality')}</Label>
            <Input
              id="personality"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder={t('me.personalityPlaceholder')}
              className="bg-[hsl(var(--su-surface-2))]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio">{t('me.bio')}</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t('me.bioPlaceholder')}
              rows={4}
              className="bg-[hsl(var(--su-surface-2))] resize-none"
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-[hsl(var(--su-surface-2))] rounded-lg p-3">
            <Shield className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <div>
              <p>{t('me.localOnly')}</p>
              <p className="mt-1">{t('me.profileUsage')}</p>
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full"
          >
            {isSaving ? (
              t('me.saving')
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                {t('me.save')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
